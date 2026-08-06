import { prisma } from '../lib/prisma.js'
import { Router, Request, Response } from 'express'

import {
  calcMarkupReverse,
  generatePricingTableForProduct,
  recalculateAllPricing,
} from '../services/pricingService.js'
import {
  generateDeliveryQuote,
  confirmDeliveryChoice,
} from '../services/logisticsService.js'

const router = Router()

// ---------------------------------------------------------------------------
// CANAIS DE VENDA
// ---------------------------------------------------------------------------

// GET /api/pricing/channels — listar canais do tenant
router.get('/channels', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any
    const channels = await prisma.salesChannel.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { pricingRules: true, orders: true } } },
    })
    res.json({ data: channels })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/pricing/channels — criar canal
router.post('/channels', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any
    const {
      name, slug, platformFeePerc, platformFeeFixed,
      paymentFeePerc, targetMarginPerc, manualMultiplier,
    } = req.body

    if (!name || !slug) {
      return res.status(400).json({ error: 'name e slug são obrigatórios' })
    }

    const channel = await prisma.salesChannel.create({
      data: {
        name, slug,
        platformFeePerc:  platformFeePerc  ?? 0,
        platformFeeFixed: platformFeeFixed ?? 0,
        paymentFeePerc:   paymentFeePerc   ?? 0,
        targetMarginPerc: targetMarginPerc ?? 30,
        manualMultiplier: manualMultiplier ?? 1,
        tenantId,
      },
    })
    res.status(201).json({ data: channel })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/pricing/channels/:id — atualizar canal e recalcular preços
router.put('/channels/:id', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any
    const { id } = req.params

    const channel = await prisma.salesChannel.findFirst({
      where: { id, tenantId },
    })
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado' })

    const updated = await prisma.salesChannel.update({
      where: { id },
      data: req.body,
    })

    // Recalcular todos os produtos desse canal
    const rules = await prisma.pricingRule.findMany({
      where: { channelId: id, tenantId },
      select: { productId: true },
    })
    for (const rule of rules) {
      await generatePricingTableForProduct(rule.productId, tenantId)
    }

    res.json({ data: updated, recalculated: rules.length })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// TABELA DE PREÇOS
// ---------------------------------------------------------------------------

// GET /api/pricing/table — tabela de preços de todos os produtos × canais
router.get('/table', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any

    const rules = await prisma.pricingRule.findMany({
      where: { tenantId, active: true },
      include: {
        product:     { select: { id: true, name: true, sku: true, costPrice: true } },
        salesChannel: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ product: { name: 'asc' } }, { salesChannel: { name: 'asc' } }],
    })

    res.json({ data: rules })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/pricing/preview — simular preço sem persistir (para uso no front)
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any
    const { costPrice, channelId } = req.body

    if (!costPrice || !channelId) {
      return res.status(400).json({ error: 'costPrice e channelId são obrigatórios' })
    }

    const channel = await prisma.salesChannel.findFirst({
      where: { id: channelId, tenantId },
    })
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado' })

    const result = calcMarkupReverse({ costPrice: Number(costPrice), channel })
    res.json({ data: result })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// POST /api/pricing/generate/:productId — gerar/recalcular tabela de um produto
router.post('/generate/:productId', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any
    const productId = String(req.params.productId ?? '')

    const results = await generatePricingTableForProduct(productId, tenantId)
    res.json({ data: results, count: results.length })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/pricing/recalculate-all — recalcular tudo (ex: após mudança de canal)
router.post('/recalculate-all', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any
    const count = await recalculateAllPricing(tenantId)
    res.json({ message: `${count} produtos recalculados`, count })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/pricing/rule/:ruleId/price — ajustar preço final manualmente
router.put('/rule/:ruleId/price', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any
    const { ruleId } = req.params
    const { finalPrice } = req.body

    const rule = await prisma.pricingRule.findFirst({
      where: { id: ruleId, tenantId },
      include: { salesChannel: true },
    })
    if (!rule) return res.status(404).json({ error: 'Regra não encontrada' })

    // Recalcular a margem real com o novo preço manual
    const ch = rule.salesChannel
    const Tm = Number(ch.platformFeePerc) / 100
    const Tf = Number(ch.platformFeeFixed)
    const Tp = Number(ch.paymentFeePerc)  / 100
    const P  = Number(finalPrice)
    const C  = Number(rule.costPrice)

    const netRevenue    = P - (P * Tm) - Tf - (P * Tp)
    const realMarginPerc = ((netRevenue - C) / P) * 100

    const updated = await prisma.pricingRule.update({
      where: { id: ruleId },
      data: { finalPrice, realMarginPerc },
    })

    res.json({ data: updated })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// FROTA PRÓPRIA
// ---------------------------------------------------------------------------

// GET /api/pricing/fleet — listar frota
router.get('/fleet', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any
    const fleet = await prisma.fleet.findMany({ where: { tenantId } })
    res.json({ data: fleet })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/pricing/fleet — cadastrar motoboy/veículo
router.post('/fleet', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any
    const fleet = await prisma.fleet.create({
      data: { ...req.body, tenantId },
    })
    res.status(201).json({ data: fleet })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/pricing/fleet/:id — atualizar motoboy/veículo
router.put('/fleet/:id', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any
    const exists = await prisma.fleet.findFirst({ where: { id: req.params.id, tenantId } })
    if (!exists) return res.status(404).json({ error: 'Não encontrado' })

    const updated = await prisma.fleet.update({
      where: { id: req.params.id },
      data: req.body,
    })
    res.json({ data: updated })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// COTAÇÃO LOGÍSTICA
// ---------------------------------------------------------------------------

// POST /api/pricing/delivery-quote — gerar cotação para um pedido
router.post('/delivery-quote', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any
    const { orderId, distanceKm } = req.body

    if (!orderId || !distanceKm) {
      return res.status(400).json({ error: 'orderId e distanceKm são obrigatórios' })
    }

    const quote = await generateDeliveryQuote(orderId, tenantId, Number(distanceKm))
    res.json({ data: quote })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/pricing/delivery-quote/confirm — operador decide a opção
router.post('/delivery-quote/confirm', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req as any
    const { orderId, choice } = req.body

    if (!['own_fleet', 'app_delivery'].includes(choice)) {
      return res.status(400).json({ error: 'choice deve ser own_fleet ou app_delivery' })
    }

    await confirmDeliveryChoice(orderId, tenantId, choice)
    res.json({ message: 'Decisão registrada' })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
