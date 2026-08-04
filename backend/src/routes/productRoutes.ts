import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { CMVService, TechSheetLine } from '../services/cmvService';

const router = Router();
const prisma = new PrismaClient();

// Helpers de resposta
const ok = (res: Response, data: unknown) => res.status(200).json({ success: true, data });
const created = (res: Response, data: unknown) => res.status(201).json({ success: true, data });
const badRequest = (res: Response, msg: string) => res.status(400).json({ success: false, error: msg });
const notFound = (res: Response) => res.status(404).json({ success: false, error: 'Recurso não encontrado.' });
const serverError = (res: Response, err: unknown) => {
  const msg = err instanceof Error ? err.message : 'Erro interno.';
  return res.status(500).json({ success: false, error: msg });
};

// ─────────────────────────────────────────────
// GET /api/products
// Lista todos os produtos do tenant com CMV
// ─────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId as string;
    const { category, type, active } = req.query;

    const where: Prisma.ProductWhereInput = { tenantId };
    if (category) where.category = String(category);
    if (type) where.productType = String(type);
    if (active !== undefined) where.active = active === 'true';

    const products = await prisma.product.findMany({
      where,
      include: {
        technicalSheet: {
          include: {
            ingredient: {
              select: { id: true, name: true, unit: true, price: true, breakageFactor: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return ok(res, products);
  } catch (err) {
    return serverError(res, err);
  }
});

// ─────────────────────────────────────────────
// GET /api/products/:id
// Obtém produto com ficha técnica e CMV detalhado
// ─────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId as string;
    const { id } = req.params;

    const product = await prisma.product.findFirst({
      where: { id, tenantId },
      include: {
        technicalSheet: {
          include: {
            ingredient: true,
          },
        },
      },
    });

    if (!product) return notFound(res);

    // Calcula CMV em tempo real (preços atuais)
    const lines: TechSheetLine[] = product.technicalSheet.map((pi) => ({
      ingredientId: pi.ingredientId,
      quantity: Number(pi.quantity),
      isMainProtein: pi.isMainProtein,
      isPackaging: pi.isPackaging,
    }));

    const cmv = await CMVService.calculate(
      tenantId,
      lines,
      Number(product.laborCost),
      Number(product.price)
    );

    return ok(res, { ...product, cmv });
  } catch (err) {
    return serverError(res, err);
  }
});

// ─────────────────────────────────────────────
// POST /api/products
// Cria produto simples ou combo com ficha técnica
// ─────────────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId as string;
    const {
      name,
      description,
      sku,
      price,
      laborCost = 0,
      category,
      productType = 'simple',
      comboOptions,
      packagingIngredientId,
      technicalSheet = [],
    } = req.body;

    // Validações básicas
    if (!name?.trim()) return badRequest(res, 'Nome do produto é obrigatório.');
    if (!sku?.trim()) return badRequest(res, 'SKU é obrigatório.');
    if (price == null || isNaN(Number(price))) return badRequest(res, 'Preço de venda inválido.');

    // Verifica SKU único no tenant
    const existing = await prisma.product.findFirst({ where: { sku, tenantId } });
    if (existing) return badRequest(res, `SKU "${sku}" já existe neste tenant.`);

    // Valida ficha técnica: para combos, exatamente 1 proteína principal
    if (productType === 'combo') {
      const mainProteins = (technicalSheet as TechSheetLine[]).filter((l) => l.isMainProtein);
      if (mainProteins.length !== 1) {
        return badRequest(res, 'Combos devem ter exatamente 1 proteína principal na ficha técnica.');
      }
    }

    // Calcula CMV antes de persistir
    const cmv = await CMVService.calculate(
      tenantId,
      technicalSheet,
      Number(laborCost),
      Number(price)
    );

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: name.trim(),
          description: description?.trim(),
          sku: sku.trim().toUpperCase(),
          price: new Prisma.Decimal(price),
          costPrice: new Prisma.Decimal(cmv.totalCostPrice),
          laborCost: new Prisma.Decimal(laborCost),
          category: category?.trim(),
          productType,
          comboOptions: comboOptions ?? undefined,
          packagingIngredientId: packagingIngredientId ?? null,
          tenantId,
        },
      });

      // Persiste ficha técnica
      if (technicalSheet.length > 0) {
        const lineData = cmv.lines.map((line) => ({
          productId: created.id,
          ingredientId: line.ingredientId,
          quantity: new Prisma.Decimal(line.quantity),
          unitCost: new Prisma.Decimal(line.unitPrice),
          totalCost: new Prisma.Decimal(line.lineCost),
          isMainProtein: line.isMainProtein,
          isPackaging: line.isPackaging,
          tenantId,
        }));
        await tx.productIngredient.createMany({ data: lineData });
      }

      return created;
    });

    return created(res, { product, cmv });
  } catch (err) {
    return serverError(res, err);
  }
});

// ─────────────────────────────────────────────
// PUT /api/products/:id
// Atualiza produto e recalcula CMV
// ─────────────────────────────────────────────
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId as string;
    const { id } = req.params;
    const {
      name,
      description,
      sku,
      price,
      laborCost,
      category,
      productType,
      comboOptions,
      packagingIngredientId,
      technicalSheet,
    } = req.body;

    const product = await prisma.product.findFirst({ where: { id, tenantId } });
    if (!product) return notFound(res);

    // Monta dados de atualização apenas com campos presentes
    const updateData: Prisma.ProductUpdateInput = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim();
    if (sku !== undefined) updateData.sku = sku.trim().toUpperCase();
    if (price !== undefined) updateData.price = new Prisma.Decimal(price);
    if (laborCost !== undefined) updateData.laborCost = new Prisma.Decimal(laborCost);
    if (category !== undefined) updateData.category = category?.trim();
    if (productType !== undefined) updateData.productType = productType;
    if (comboOptions !== undefined) updateData.comboOptions = comboOptions;
    if (packagingIngredientId !== undefined) updateData.packagingIngredientId = packagingIngredientId;

    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: updateData });

      // Se a ficha técnica foi enviada, substitui completamente
      if (technicalSheet !== undefined) {
        await tx.productIngredient.deleteMany({ where: { productId: id } });

        const finalPrice = price !== undefined ? Number(price) : Number(product.price);
        const finalLabor = laborCost !== undefined ? Number(laborCost) : Number(product.laborCost);

        const cmv = await CMVService.calculate(tenantId, technicalSheet, finalLabor, finalPrice);

        if (technicalSheet.length > 0) {
          const lineData = cmv.lines.map((line) => ({
            productId: id,
            ingredientId: line.ingredientId,
            quantity: new Prisma.Decimal(line.quantity),
            unitCost: new Prisma.Decimal(line.unitPrice),
            totalCost: new Prisma.Decimal(line.lineCost),
            isMainProtein: line.isMainProtein,
            isPackaging: line.isPackaging,
            tenantId,
          }));
          await tx.productIngredient.createMany({ data: lineData });
        }

        await tx.product.update({
          where: { id },
          data: { costPrice: new Prisma.Decimal(cmv.totalCostPrice) },
        });
      }
    });

    // Retorna produto atualizado com CMV recalculado
    const updated = await prisma.product.findFirst({
      where: { id },
      include: { technicalSheet: { include: { ingredient: true } } },
    });

    return ok(res, updated);
  } catch (err) {
    return serverError(res, err);
  }
});

// ─────────────────────────────────────────────
// POST /api/products/:id/recalculate-cmv
// Força recálculo do CMV com preços atuais dos insumos
// ─────────────────────────────────────────────
router.post('/:id/recalculate-cmv', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId as string;
    const { id } = req.params;

    const product = await prisma.product.findFirst({ where: { id, tenantId } });
    if (!product) return notFound(res);

    const newCostPrice = await CMVService.recalculateAndPersist(id, tenantId);
    return ok(res, { productId: id, newCostPrice });
  } catch (err) {
    return serverError(res, err);
  }
});

// ─────────────────────────────────────────────
// POST /api/products/preview-cmv
// Calcula CMV sem persistir — usado pelo frontend em tempo real
// ─────────────────────────────────────────────
router.post('/preview-cmv', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId as string;
    const { technicalSheet = [], laborCost = 0, salePrice = 0 } = req.body;

    const cmv = await CMVService.calculate(
      tenantId,
      technicalSheet,
      Number(laborCost),
      Number(salePrice)
    );

    return ok(res, cmv);
  } catch (err) {
    return serverError(res, err);
  }
});

// ─────────────────────────────────────────────
// POST /api/products/resolve-combo
// Resolve qual proteína principal será debitada no combo
// ─────────────────────────────────────────────
router.post('/resolve-combo', async (req: Request, res: Response) => {
  try {
    const { technicalSheet, selectedProteinId } = req.body;

    if (!technicalSheet || !selectedProteinId) {
      return badRequest(res, 'technicalSheet e selectedProteinId são obrigatórios.');
    }

    const resolved = CMVService.resolveComboProtein(technicalSheet, selectedProteinId);
    return ok(res, { resolvedSheet: resolved });
  } catch (err) {
    return serverError(res, err);
  }
});

// ─────────────────────────────────────────────
// DELETE /api/products/:id
// ─────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId as string;
    const { id } = req.params;

    const product = await prisma.product.findFirst({ where: { id, tenantId } });
    if (!product) return notFound(res);

    await prisma.product.delete({ where: { id } });
    return ok(res, { deleted: id });
  } catch (err) {
    return serverError(res, err);
  }
});

export default router;
