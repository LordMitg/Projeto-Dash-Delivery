import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { CMVService, TechSheetLine } from '../services/cmvService.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();

/**
 * Guard de ESCRITA de produtos.
 *
 * O mount em index.ts libera a leitura tambem para `pdv:use` (o caixa precisa
 * ver o que vende). Sem este guard nas rotas de escrita, esse mesmo mount dava
 * ao caixa CRUD completo — criar, editar e APAGAR produto. Ler e uma permissao,
 * alterar o catalogo e outra.
 */
const canWriteProducts = requirePermission('products:manage');

// Helpers de resposta
const ok = (res: Response, data: unknown) => res.status(200).json({ success: true, data });
const sendCreated = (res: Response, data: unknown) => res.status(201).json({ success: true, data });
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
    const tenantId = req.auth!.tenantId;
    const { category, type, active, search, categoryId } = req.query;

    const where: Prisma.ProductWhereInput = { tenantId };
    if (category) where.category = String(category);
    if (categoryId) where.menuCategoryId = String(categoryId);
    if (type) where.productType = String(type);
    if (active !== undefined) where.active = active === 'true';

    // Busca livre por nome, SKU ou codigo de barras (usada pelo PDV).
    if (search) {
      const term = String(search).trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { sku: { contains: term, mode: 'insensitive' } },
        { barcode: term },
      ];
    }

    const products = await prisma.product.findMany({
      where,
      include: {
        menuCategory: { select: { id: true, name: true, slug: true, sortOrder: true } },
        addons: {
          where: { active: true },
          orderBy: [{ groupName: 'asc' }, { sortOrder: 'asc' }],
        },
        technicalSheet: {
          include: {
            ingredient: {
              select: { id: true, name: true, unit: true, price: true, breakageFactor: true, stock: true },
            },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return ok(res, products);
  } catch (err) {
    return serverError(res, err);
  }
});

// ─────────────────────────────────────────────
// GET /api/products/barcode/:code
// Busca produto por codigo de barras — usada pelo scanner do celular.
// Precisa vir ANTES de `/:id`, senao o Express trata "barcode" como um id.
// ─────────────────────────────────────────────
router.get('/barcode/:code', async (req: Request, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId;
    const code = String(req.params.code ?? '').trim();

    const product = await prisma.product.findFirst({
      where: { tenantId, barcode: code },
      include: {
        menuCategory: { select: { id: true, name: true } },
        addons: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!product) {
      // `code` e o codigo de ERRO (o frontend usa para decidir a acao);
      // o codigo de barras lido vai em `barcode`, senao o cliente
      // interpretaria "7891..." como um tipo de erro.
      return res.status(404).json({
        success: false,
        error: `Nenhum produto cadastrado com o codigo ${code}.`,
        code: 'BARCODE_NOT_FOUND',
        barcode: code,
      });
    }

    return ok(res, product);
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
    const tenantId = req.auth!.tenantId;
    const id = String(req.params.id ?? '');

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
router.post('/', canWriteProducts, async (req: Request, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId;
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
      // Campos do cardapio
      barcode,
      imageUrl,
      menuCategoryId,
      sortOrder = 0,
      featured = false,
    } = req.body;

    // Validações básicas
    if (!name?.trim()) return badRequest(res, 'Nome do produto é obrigatório.');
    if (!sku?.trim()) return badRequest(res, 'SKU é obrigatório.');
    if (price == null || isNaN(Number(price))) return badRequest(res, 'Preço de venda inválido.');

    // Verifica SKU único no tenant
    const existing = await prisma.product.findFirst({ where: { sku, tenantId } });
    if (existing) return badRequest(res, `SKU "${sku}" já existe neste tenant.`);

    // Codigo de barras nao pode repetir dentro da mesma loja, senao o
    // scanner do celular ficaria ambiguo.
    const cleanBarcode = barcode?.trim() || null;
    if (cleanBarcode) {
      const dupBarcode = await prisma.product.findFirst({
        where: { barcode: cleanBarcode, tenantId },
      });
      if (dupBarcode) {
        return badRequest(
          res,
          `O codigo de barras ${cleanBarcode} ja esta em uso pelo produto "${dupBarcode.name}".`,
        );
      }
    }

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
      // Nome `newProduct` em vez de `created`: antes esta variavel sombreava
      // o helper de resposta `created()` definido no topo do arquivo.
      const newProduct = await tx.product.create({
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
          barcode: cleanBarcode,
          imageUrl: imageUrl?.trim() || null,
          menuCategoryId: menuCategoryId || null,
          sortOrder: Number(sortOrder) || 0,
          featured: Boolean(featured),
          tenantId,
        },
      });

      // Persiste ficha técnica
      if (technicalSheet.length > 0) {
        const lineData = cmv.lines.map((line) => ({
          productId: newProduct.id,
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

      return newProduct;
    });

    return sendCreated(res, { product, cmv });
  } catch (err) {
    return serverError(res, err);
  }
});

// ─────────────────────────────────────────────
// PUT /api/products/:id
// Atualiza produto e recalcula CMV
// ─────────────────────────────────────────────
router.put('/:id', canWriteProducts, async (req: Request, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId;
    const id = String(req.params.id ?? '');
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
      barcode,
      imageUrl,
      menuCategoryId,
      sortOrder,
      featured,
      active,
    } = req.body;

    const product = await prisma.product.findFirst({ where: { id, tenantId } });
    if (!product) return notFound(res);

    // Codigo de barras precisa continuar unico dentro da loja.
    if (barcode !== undefined && barcode?.trim()) {
      const dupBarcode = await prisma.product.findFirst({
        where: { barcode: barcode.trim(), tenantId, id: { not: id } },
      });
      if (dupBarcode) {
        return badRequest(
          res,
          `O codigo de barras ${barcode.trim()} ja esta em uso pelo produto "${dupBarcode.name}".`,
        );
      }
    }

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
    if (barcode !== undefined) updateData.barcode = barcode?.trim() || null;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl?.trim() || null;
    if (sortOrder !== undefined) updateData.sortOrder = Number(sortOrder) || 0;
    if (featured !== undefined) updateData.featured = Boolean(featured);
    if (active !== undefined) updateData.active = Boolean(active);
    if (menuCategoryId !== undefined) {
      updateData.menuCategory = menuCategoryId
        ? { connect: { id: menuCategoryId } }
        : { disconnect: true };
    }

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
// Persiste o novo custo via `recalculateAndPersist`, entao e escrita — ao
// contrario de `preview-cmv`/`resolve-combo`, que apenas calculam.
router.post('/:id/recalculate-cmv', canWriteProducts, async (req: Request, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId;
    const id = String(req.params.id ?? '');

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
    const tenantId = req.auth!.tenantId;
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
// ──────────────────────────��──────────────────
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
router.delete('/:id', canWriteProducts, async (req: Request, res: Response) => {
  try {
    const tenantId = req.auth!.tenantId;
    const id = String(req.params.id ?? '');

    const product = await prisma.product.findFirst({ where: { id, tenantId } });
    if (!product) return notFound(res);

    await prisma.product.delete({ where: { id } });
    return ok(res, { deleted: id });
  } catch (err) {
    return serverError(res, err);
  }
});

export default router;
