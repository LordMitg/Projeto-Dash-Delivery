import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// GET /api/financial/kpis?period=month
router.get('/kpis', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenant?.id;
    const period = req.query.period as string || 'month';

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Calcular datas baseado no período
    const today = new Date();
    let startDate = new Date();
    let previousStart = new Date();

    if (period === 'today') {
      startDate.setHours(0, 0, 0, 0);
      previousStart = new Date(startDate);
      previousStart.setDate(previousStart.getDate() - 1);
    } else if (period === 'week') {
      const dayOfWeek = today.getDay();
      startDate.setDate(today.getDate() - dayOfWeek);
      startDate.setHours(0, 0, 0, 0);
      previousStart = new Date(startDate);
      previousStart.setDate(previousStart.getDate() - 7);
    } else { // month
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      previousStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    }

    const previousEnd = new Date(startDate);
    previousEnd.setTime(previousEnd.getTime() - 1);

    // Receita atual
    const currentOrders = await prisma.order.findMany({
      where: {
        tenantId,
        paymentStatus: 'paid',
        createdAt: { gte: startDate }
      },
      select: { totalAmount: true, discount: true }
    });

    const currentRevenue = currentOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const currentDiscount = currentOrders.reduce((sum, o) => sum + Number(o.discount), 0);

    // Receita período anterior
    const previousOrders = await prisma.order.findMany({
      where: {
        tenantId,
        paymentStatus: 'paid',
        createdAt: { gte: previousStart, lte: previousEnd }
      },
      select: { totalAmount: true }
    });

    const previousRevenue = previousOrders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

    // CMV (soma de itens × custo do produto)
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: { tenantId, paymentStatus: 'paid', createdAt: { gte: startDate } }
      },
      include: { product: true }
    });

    const cmvAmount = orderItems.reduce((sum, item) => {
      return sum + (Number(item.product.costPrice) * item.quantity);
    }, 0);

    const cmvPercentage = currentRevenue > 0 ? (cmvAmount / currentRevenue) * 100 : 0;
    const grossMargin = currentRevenue - cmvAmount;
    const grossMarginPerc = currentRevenue > 0 ? (grossMargin / currentRevenue) * 100 : 0;

    // Variação de receita
    const revenueVariation = previousRevenue > 0 
      ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 
      : 0;

    // Ticket médio
    const averageTicket = currentOrders.length > 0 ? currentRevenue / currentOrders.length : 0;
    const previousAvgTicket = previousOrders.length > 0 ? previousRevenue / previousOrders.length : 0;
    const ticketVariation = previousAvgTicket > 0
      ? ((averageTicket - previousAvgTicket) / previousAvgTicket) * 100
      : 0;

    // LTV médio
    const customers = await prisma.customer.findMany({
      where: { 
        orders: { some: { tenantId, createdAt: { gte: startDate } } }
      },
      select: { ltv: true }
    });

    const averageLTV = customers.length > 0 
      ? customers.reduce((sum, c) => sum + Number(c.ltv), 0) / customers.length 
      : 0;

    const previousCustomers = await prisma.customer.findMany({
      where: { 
        orders: { some: { tenantId, createdAt: { gte: previousStart, lte: previousEnd } } }
      },
      select: { ltv: true }
    });

    const previousAvgLTV = previousCustomers.length > 0
      ? previousCustomers.reduce((sum, c) => sum + Number(c.ltv), 0) / previousCustomers.length
      : 0;

    const ltvVariation = previousAvgLTV > 0
      ? ((averageLTV - previousAvgLTV) / previousAvgLTV) * 100
      : 0;

    // Total de pedidos e variação
    const totalOrders = currentOrders.length;
    const previousTotalOrders = previousOrders.length;
    const ordersVariation = previousTotalOrders > 0
      ? ((totalOrders - previousTotalOrders) / previousTotalOrders) * 100
      : 0;

    res.json({
      revenue: currentRevenue,
      revenueVariation: parseFloat(revenueVariation.toFixed(2)),
      cmvAmount,
      cmvPercentage: parseFloat(cmvPercentage.toFixed(2)),
      grossMargin,
      grossMarginVariation: 0, // Adicionar lógica similar a revenueVariation
      averageTicket,
      averageTicketVariation: parseFloat(ticketVariation.toFixed(2)),
      averageLTV,
      ltpVariation: parseFloat(ltvVariation.toFixed(2)),
      totalOrders,
      ordersVariation: parseFloat(ordersVariation.toFixed(2)),
      activeCustomers: customers.length,
    });
  } catch (error) {
    console.error('[Backend] Erro ao buscar KPIs:', error);
    res.status(500).json({ error: 'Erro ao buscar KPIs' });
  }
});

// GET /api/financial/dre?month=&year=
router.get('/dre', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenant?.id;
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    // Receita
    const orders = await prisma.order.findMany({
      where: { tenantId, paymentStatus: 'paid', createdAt: { gte: startDate, lte: endDate } }
    });

    const revenue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const discounts = orders.reduce((sum, o) => sum + Number(o.discount), 0);

    // CMV
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: { tenantId, paymentStatus: 'paid', createdAt: { gte: startDate, lte: endDate } }
      },
      include: { product: true }
    });

    const cogs = orderItems.reduce((sum, item) => sum + (Number(item.product.costPrice) * item.quantity), 0);

    // Despesas
    const expenses = await prisma.accountPayable.findMany({
      where: { tenantId, paidAt: { gte: startDate, lte: endDate } }
    });

    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

    res.json({
      month,
      year,
      revenue,
      discounts,
      netRevenue: revenue - discounts,
      cogs,
      grossProfit: revenue - cogs,
      expenses: totalExpenses,
      ebitda: revenue - cogs - totalExpenses,
      netIncome: revenue - cogs - totalExpenses,
    });
  } catch (error) {
    console.error('[Backend] Erro ao buscar DRE:', error);
    res.status(500).json({ error: 'Erro ao buscar DRE' });
  }
});

export default router;
