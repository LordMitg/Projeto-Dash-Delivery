import { prisma } from '../lib/prisma.js'
import { Router, Request, Response } from 'express'

import { validate, z, idSchema, money, numeric } from '../lib/validate.js'
import { requirePermission } from '../middleware/auth.js'
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

/**
 * SEGURANCA — por que este arquivo mudou.
 *
 * As rotas de escrita gravavam `data: req.body` (e `{ ...req.body }`) direto no
 * Prisma. Como nada filtrava as chaves, era possivel enviar campos que o
 * servidor deveria controlar. Comprovado em teste: um PUT com
 * `{"tenantId": "<id de outra loja>"}` transferia o canal de venda para a outra
 * empresa, respondendo 200.
 *
 * Correcao aplicada em todas as rotas deste arquivo:
 *   1. schema Zod com a lista explicita dos campos aceitos (o Zod descarta o
 *      resto, entao `tenantId`, `id`, `createdAt` e afins nunca chegam ao banco);
 *   2. o objeto `data:` e montado campo por campo — nunca o corpo do request;
 *   3. `tenantId` vem so de `req.auth`, ou seja, do token da sessao;
 *   4. escrita agora exige `pricing:manage`. Antes o roteador inteiro pedia
 *      apenas `pricing:view`, e cargos com so essa permissao alteravam precos.
 */

/** Percentual de 0 a 100. */
const percent = numeric({ min: 0, max: 100 })

/** Somente escrita: `pricing:view` nao basta para alterar preco. */
const canManagePricing = requirePermission('pricing:manage')

const channelFields = {
  name: z.string().trim().min(1, 'Nome obrigatorio').max(80),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug obrigatorio')
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Slug aceita apenas letras minusculas, numeros e hifen'),
  platformFeePerc: percent.optional(),
  platformFeeFixed: money.optional(),
  paymentFeePerc: percent.optional(),
  targetMarginPerc: percent.optional(),
  manualMultiplier: numeric({ min: 0.01, max: 10 }).optional(),
  active: z.boolean().optional(),
}

const channelCreateSchema = z.object(channelFields)
const channelUpdateSchema = z
  .object({ ...channelFields, name: channelFields.name.optional(), slug: channelFields.slug.optional() })
  .refine((b) => Object.keys(b).length > 0, 'Envie ao menos um campo para atualizar')

const fleetFields = {
  name: z.string().trim().min(1, 'Nome obrigatorio').max(80),
  vehicleType: z.enum(['moto', 'carro', 'bicicleta']).optional(),
  kmPerLiter: numeric({ min: 0.1, max: 999 }).optional(),
  fuelCostPerLiter: money.optional(),
  deliveryFee: money.optional(),
  feePerKm: money.optional(),
  baseRadiusKm: numeric({ min: 0, max: 999 }).optional(),
  active: z.boolean().optional(),
}

const fleetCreateSchema = z.object(fleetFields)
const fleetUpdateSchema = z
  .object({ ...fleetFields, name: fleetFields.name.optional() })
  .refine((b) => Object.keys(b).length > 0, 'Envie ao menos um campo para atualizar')

/**
 * Copia para o `data:` do Prisma apenas as chaves listadas, e so quando vieram
 * no request. Assim um PATCH parcial nao apaga campo que o usuario nao enviou,
 * e nenhuma chave extra passa.
 */
function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]) {
  const out: Partial<Pick<T, K>> = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}

const CHANNEL_KEYS = [
  'name',
  'slug',
  'platformFeePerc',
  'platformFeeFixed',
  'paymentFeePerc',
  'targetMarginPerc',
  'manualMultiplier',
  'active',
] as const

const FLEET_KEYS = [
  'name',
  'vehicleType',
  'kmPerLiter',
  'fuelCostPerLiter',
  'deliveryFee',
  'feePerKm',
  'baseRadiusKm',
  'active',
] as const

// ---------------------------------------------------------------------------
// CANAIS DE VENDA
// ---------------------------------------------------------------------------

// GET /api/pricing/channels — listar canais do tenant
router.get('/channels', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.auth!
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
router.post(
  '/channels',
  canManagePricing,
  validate({ body: channelCreateSchema }),
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!
      const body = req.body as z.infer<typeof channelCreateSchema>

      const channel = await prisma.salesChannel.create({
        data: {
          name: body.name,
          slug: body.slug,
          platformFeePerc: body.platformFeePerc ?? 0,
          platformFeeFixed: body.platformFeeFixed ?? 0,
          paymentFeePerc: body.paymentFeePerc ?? 0,
          targetMarginPerc: body.targetMarginPerc ?? 30,
          manualMultiplier: body.manualMultiplier ?? 1,
          active: body.active ?? true,
          tenantId,
        },
      })
      res.status(201).json({ data: channel })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  },
)

// PUT /api/pricing/channels/:id — atualizar canal e recalcular preços
router.put(
  '/channels/:id',
  canManagePricing,
  validate({ params: z.object({ id: idSchema }), body: channelUpdateSchema }),
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!
      const { id } = req.params
      const body = req.body as z.infer<typeof channelUpdateSchema>

      const channel = await prisma.salesChannel.findFirst({
        where: { id, tenantId },
      })
      if (!channel) return res.status(404).json({ error: 'Canal não encontrado' })

      // `updateMany` com tenantId no where: mesmo que o id escape do findFirst
      // acima, o banco ainda recusa gravar em registro de outra loja.
      const data = pick(body, CHANNEL_KEYS)
      await prisma.salesChannel.updateMany({ where: { id, tenantId }, data })
      const updated = await prisma.salesChannel.findFirst({ where: { id, tenantId } })

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
  },
)

// ---------------------------------------------------------------------------
// TABELA DE PREÇOS
// ---------------------------------------------------------------------------

// GET /api/pricing/table — tabela de preços de todos os produtos × canais
router.get('/table', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.auth!

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
router.post(
  '/preview',
  validate({
    body: z.object({
      costPrice: money,
      channelId: idSchema,
    }),
  }),
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!
      const { costPrice, channelId } = req.body as { costPrice: number; channelId: string }

      const channel = await prisma.salesChannel.findFirst({
        where: { id: channelId, tenantId },
      })
      if (!channel) return res.status(404).json({ error: 'Canal não encontrado' })

      const result = calcMarkupReverse({ costPrice: Number(costPrice), channel })
      res.json({ data: result })
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  },
)

// POST /api/pricing/generate/:productId — gerar/recalcular tabela de um produto
router.post(
  '/generate/:productId',
  canManagePricing,
  validate({ params: z.object({ productId: idSchema }) }),
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!
      const productId = String(req.params.productId ?? '')

      const results = await generatePricingTableForProduct(productId, tenantId)
      res.json({ data: results, count: results.length })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  },
)

// POST /api/pricing/recalculate-all — recalcular tudo (ex: após mudança de canal)
router.post('/recalculate-all', canManagePricing, async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.auth!
    const count = await recalculateAllPricing(tenantId)
    res.json({ message: `${count} produtos recalculados`, count })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/pricing/rule/:ruleId/price — ajustar preço final manualmente
router.put(
  '/rule/:ruleId/price',
  canManagePricing,
  validate({
    params: z.object({ ruleId: idSchema }),
    // Minimo 0.01: o preco final e divisor no calculo da margem, e zero
    // produzia Infinity e derrubava a rota com erro 500.
    body: z.object({ finalPrice: numeric({ min: 0.01, max: 9_999_999 }) }),
  }),
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!
      const { ruleId } = req.params
      const { finalPrice } = req.body as { finalPrice: number }

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

      await prisma.pricingRule.updateMany({
        where: { id: ruleId, tenantId },
        data: { finalPrice, realMarginPerc },
      })
      const updated = await prisma.pricingRule.findFirst({ where: { id: ruleId, tenantId } })

      res.json({ data: updated })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  },
)

// ---------------------------------------------------------------------------
// FROTA PRÓPRIA
// ---------------------------------------------------------------------------

// GET /api/pricing/fleet — listar frota
router.get('/fleet', async (req: Request, res: Response) => {
  try {
    const { tenantId } = req.auth!
    const fleet = await prisma.fleet.findMany({ where: { tenantId } })
    res.json({ data: fleet })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/pricing/fleet — cadastrar motoboy/veículo
router.post(
  '/fleet',
  canManagePricing,
  validate({ body: fleetCreateSchema }),
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!
      const body = req.body as z.infer<typeof fleetCreateSchema>

      const fleet = await prisma.fleet.create({
        data: { ...pick(body, FLEET_KEYS), name: body.name, tenantId },
      })
      res.status(201).json({ data: fleet })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  },
)

// PUT /api/pricing/fleet/:id — atualizar motoboy/veículo
router.put(
  '/fleet/:id',
  canManagePricing,
  validate({ params: z.object({ id: idSchema }), body: fleetUpdateSchema }),
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!
      const id = String(req.params.id ?? '')
      const body = req.body as z.infer<typeof fleetUpdateSchema>

      const exists = await prisma.fleet.findFirst({ where: { id, tenantId } })
      if (!exists) return res.status(404).json({ error: 'Não encontrado' })

      await prisma.fleet.updateMany({ where: { id, tenantId }, data: pick(body, FLEET_KEYS) })
      const updated = await prisma.fleet.findFirst({ where: { id, tenantId } })
      res.json({ data: updated })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  },
)

// ---------------------------------------------------------------------------
// COTAÇÃO LOGÍSTICA
// ---------------------------------------------------------------------------

// POST /api/pricing/delivery-quote — gerar cotação para um pedido
router.post(
  '/delivery-quote',
  validate({
    body: z.object({
      orderId: idSchema,
      distanceKm: numeric({ min: 0.1, max: 500 }),
    }),
  }),
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!
      const { orderId, distanceKm } = req.body as { orderId: string; distanceKm: number }

      const quote = await generateDeliveryQuote(orderId, tenantId, Number(distanceKm))
      res.json({ data: quote })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  },
)

// POST /api/pricing/delivery-quote/confirm — operador decide a opção
router.post(
  '/delivery-quote/confirm',
  validate({
    body: z.object({
      orderId: idSchema,
      choice: z.enum(['own_fleet', 'app_delivery'], {
        errorMap: () => ({ message: 'choice deve ser own_fleet ou app_delivery' }),
      }),
    }),
  }),
  async (req: Request, res: Response) => {
    try {
      const { tenantId } = req.auth!
      const { orderId, choice } = req.body as {
        orderId: string
        choice: 'own_fleet' | 'app_delivery'
      }

      await confirmDeliveryChoice(orderId, tenantId, choice)
      res.json({ message: 'Decisão registrada' })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  },
)

export default router
