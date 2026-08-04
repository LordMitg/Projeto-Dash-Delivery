import { Router, Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { tenantMiddleware } from '../middleware/tenant';

const router = Router();
const prisma = new PrismaClient();

// Aplicar middleware de tenant em todas as rotas
router.use(tenantMiddleware);

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateOrderNumber(): string {
  const date = new Date();
  const prefix = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `${prefix}-${random}`;
}

// ─── GET /api/orders — listar pedidos do dia ─────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { date, status } = req.query;

    const startOfDay = date
      ? new Date(`${date}T00:00:00`)
      : new Date(new Date().setHours(0, 0, 0, 0));
    const endOfDay = new Date(startOfDay);
    endOfDay.setHours(23, 59, 59, 999);

    const where: Prisma.OrderWhereInput = {
      tenantId,
      createdAt: { gte: startOfDay, lte: endOfDay },
      ...(status ? { status: String(status) } : {}),
    };

    const orders = await prisma.order.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        orderItems: {
          include: {
            product: { select: { id: true, name: true, category: true } },
          },
        },
        delivery: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ orders });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao listar pedidos', details: error });
  }
});

// ─── GET /api/orders/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { id, tenantId },
      include: {
        customer: true,
        orderItems: {
          include: { product: true },
        },
        delivery: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!order) return res.status(404).json({ error: 'Pedido não encontrado' });
    return res.json({ order });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao buscar pedido', details: error });
  }
});

// ─── POST /api/orders — criar pedido (PDV) ───────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;

    const {
      items,             // [{ productId, quantity, unitPrice, observations, selectedProteinId, selectedProteinName }]
      customerId,        // opcional — null para balcão anônimo
      newCustomer,       // opcional — { name, phone, address, city, state, zipCode }
      orderType = 'delivery',
      paymentMethod = 'cash',
      discount = 0,
      observations,
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Pedido deve ter ao menos 1 item' });
    }

    // ── Validar produtos e preços server-side ──────────────────────────────
    const productIds = items.map((i: any) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, tenantId, active: true },
    });

    if (products.length !== productIds.length) {
      return res.status(400).json({ error: 'Um ou mais produtos inválidos' });
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    // ── Calcular totais com preço oficial do servidor ───────────────────────
    const orderItemsData = items.map((item: any) => {
      const product = productMap.get(item.productId)!;
      const qty = Math.max(1, Math.floor(Number(item.quantity)));
      const unitPrice = Number(product.price);
      return {
        productId: item.productId,
        quantity: qty,
        unitPrice: new Prisma.Decimal(unitPrice),
        subtotal: new Prisma.Decimal(unitPrice * qty),
        observations: item.observations || null,
        selectedProteinId: item.selectedProteinId || null,
        selectedProteinName: item.selectedProteinName || null,
      };
    });

    const subtotalSum = orderItemsData.reduce(
      (acc: number, i: any) => acc + Number(i.subtotal),
      0
    );
    const discountVal = Math.min(Number(discount), subtotalSum);
    const totalAmount = subtotalSum - discountVal;

    // ── Transação: criar pedido + atualizar LTV do cliente ─────────────────
    const result = await prisma.$transaction(async (tx) => {
      // 1. Resolver cliente
      let resolvedCustomerId: string | null = customerId || null;

      if (!resolvedCustomerId && newCustomer?.name) {
        // Checar se já existe pelo telefone
        const existing = await tx.customer.findFirst({
          where: { phone: newCustomer.phone, tenantId },
        });

        if (existing) {
          resolvedCustomerId = existing.id;
        } else {
          const created = await tx.customer.create({
            data: {
              name: newCustomer.name,
              phone: newCustomer.phone || '',
              address: newCustomer.address || '',
              city: newCustomer.city || '',
              state: newCustomer.state || '',
              zipCode: newCustomer.zipCode || '',
              tenantId,
            },
          });
          resolvedCustomerId = created.id;
        }
      }

      // 2. Criar pedido
      const order = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          status: 'pending',
          orderType,
          totalAmount: new Prisma.Decimal(totalAmount),
          discount: new Prisma.Decimal(discountVal),
          paymentMethod,
          paymentStatus: paymentMethod !== 'fiado' ? 'paid' : 'pending',
          observations: observations || null,
          tenantId,
          createdById: userId,
          customerId: resolvedCustomerId,
          orderItems: { create: orderItemsData },
        },
        include: {
          orderItems: { include: { product: true } },
          customer: true,
        },
      });

      // 3. Atualizar LTV do cliente se existir
      if (resolvedCustomerId) {
        await tx.customer.update({
          where: { id: resolvedCustomerId },
          data: {
            ltv: { increment: totalAmount },
            totalOrders: { increment: 1 },
            lastOrderAt: new Date(),
          },
        });
      }

      return order;
    });

    return res.status(201).json({ order: result });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao criar pedido', details: error });
  }
});

// ─── PATCH /api/orders/:id/status — atualizar status ────────────────────────
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'dispatched', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }

    const order = await prisma.order.updateMany({
      where: { id, tenantId },
      data: { status },
    });

    if (order.count === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
    return res.json({ success: true, status });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao atualizar status', details: error });
  }
});

// ─── PATCH /api/orders/:id/printed — marcar comanda impressa ─────────────────
router.patch('/:id/printed', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    const { type } = req.body; // 'kitchen' | 'delivery'

    const data: any = {};
    if (type === 'kitchen') data.printedKitchen = true;
    if (type === 'delivery') data.printedDelivery = true;

    await prisma.order.updateMany({ where: { id, tenantId }, data });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao marcar impressão', details: error });
  }
});

export default router;
