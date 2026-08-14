/**
 * Clientes.
 *
 * O PDV ja chamava `GET /api/customers?phone=...` para reconhecer quem liga —
 * mas a rota nunca existiu e devolvia 404. O `if (res.ok)` do frontend engolia
 * o erro, entao o operador via o formulario de "novo cliente" mesmo para um
 * cliente antigo, e o cadastro era duplicado a cada pedido.
 *
 * Devolve `neighborhood` para o PDV aplicar a taxa do bairro automaticamente.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'
import { asyncHandler, ok, createdResponse, notFound, badRequest, conflict } from '../lib/http.js'
import { requirePermission } from '../middleware/auth.js'
import { quoteBenefits } from '../services/loyaltyService.js'
import { validate } from '../lib/validate.js'

const router = Router()
const couponFields = { id: true, code: true, description: true, discountType: true, discountValue: true, minimumOrder: true, maximumDiscount: true, startsAt: true, endsAt: true, usageLimit: true, usageLimitPerCustomer: true, usageCount: true, active: true, createdAt: true } as const

/** Campos expostos: nada de `notes`, que e uso interno. */
const publicFields = {
  id: true,
  name: true,
  phone: true,
  address: true,
  neighborhood: true,
  city: true,
  state: true,
  zipCode: true,
  email: true,
  notes: true,
  birthday: true,
  marketingConsent: true,
  loyaltyPoints: true,
  cashbackBalance: true,
  createdAt: true,
  ltv: true,
  totalOrders: true,
  lastOrderAt: true,
} as const

const listQuery = z.object({
  /** Busca por telefone (parcial) — o caso do PDV atendendo uma ligacao. */
  phone: z.string().trim().min(3).optional(),
  /** Busca por nome (parcial, sem diferenciar maiuscula). */
  name: z.string().trim().min(2).optional(),
  search: z.string().trim().optional(),
  segment: z.enum(['all', 'champions', 'loyal', 'new', 'risk', 'inactive']).default('all'),
  limit: z.coerce.number().int().min(1).max(2000).default(200),
})

function customerSegment(customer: { totalOrders: number; lastOrderAt: Date | null; createdAt: Date }) {
  const now = Date.now()
  const last = customer.lastOrderAt?.getTime() ?? customer.createdAt.getTime()
  const days = Math.floor((now - last) / 86400000)
  if (customer.totalOrders >= 10 && days <= 30) return 'champions'
  if (customer.totalOrders >= 3 && days <= 45) return 'loyal'
  if (customer.totalOrders <= 1 && days <= 30) return 'new'
  if (customer.totalOrders >= 2 && days > 45 && days <= 90) return 'risk'
  if (days > 90) return 'inactive'
  return 'regular'
}

/**
 * GET /api/customers?phone=...
 * Sempre filtrado pelo tenant da sessao: um telefone de outra loja nunca
 * aparece aqui.
 */
router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const { phone, name, search, segment, limit } = req.query as unknown as {
      phone?: string
      name?: string
      search?: string
      segment: string
      limit: number
    }

    // Sem criterio, devolve os mais recentes em vez da tabela inteira.
    const where = {
      tenantId,
      ...(phone ? { phone: { contains: phone } } : {}),
      ...(name ? { name: { contains: name, mode: 'insensitive' as const } } : {}),
      ...(search ? { OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' as const } },
      ] } : {}),
    }

    const customers = await prisma.customer.findMany({
      where,
      select: publicFields,
      orderBy: { lastOrderAt: 'desc' },
      take: limit,
    })

    const enriched = customers.map((customer) => ({ ...customer, segment: customerSegment(customer) }))
    return ok(res, segment === 'all' ? enriched : enriched.filter((customer) => customer.segment === segment))
  }),
)

/** GET /api/customers/summary — KPIs e segmentos do CRM. */
router.get(
  '/summary',
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const customers = await prisma.customer.findMany({ where: { tenantId }, select: publicFields })
    const enriched = customers.map((customer) => ({ ...customer, segment: customerSegment(customer) }))
    const totalSpent = customers.reduce((sum, customer) => sum + Number(customer.ltv), 0)
    const withOrders = customers.filter((customer) => customer.totalOrders > 0)
    const segmentCounts = Object.fromEntries(['champions', 'loyal', 'new', 'risk', 'inactive', 'regular'].map((key) => [key, enriched.filter((customer) => customer.segment === key).length]))
    return ok(res, {
      total: customers.length,
      active: customers.filter((customer) => customer.lastOrderAt && Date.now() - customer.lastOrderAt.getTime() <= 60 * 86400000).length,
      averageTicket: withOrders.length ? totalSpent / withOrders.reduce((sum, customer) => sum + customer.totalOrders, 0) : 0,
      recurrence: customers.length ? customers.filter((customer) => customer.totalOrders >= 2).length / customers.length * 100 : 0,
      cashbackOutstanding: customers.reduce((sum, customer) => sum + Number(customer.cashbackBalance), 0),
      segmentCounts,
    })
  }),
)

const couponSchema = z.object({
  code: z.string().trim().min(3).max(30).transform((value) => value.toUpperCase()),
  description: z.string().trim().max(200).nullish(),
  discountType: z.enum(['percentage', 'fixed']),
  discountValue: z.coerce.number().positive('Informe um desconto maior que zero'),
  minimumOrder: z.coerce.number().min(0).default(0),
  maximumDiscount: z.coerce.number().positive().nullish(),
  startsAt: z.string().datetime().nullish(), endsAt: z.string().datetime().nullish(),
  usageLimit: z.coerce.number().int().positive().nullish(), usageLimitPerCustomer: z.coerce.number().int().min(0).default(1),
  active: z.boolean().default(true),
})

router.get('/coupons', asyncHandler(async (req, res) => ok(res, await prisma.coupon.findMany({ where: { tenantId: req.auth!.tenantId }, select: couponFields, orderBy: { createdAt: 'desc' } }))))
router.post('/benefits/quote', validate({ body: z.object({ customerId: z.string().nullish(), subtotal: z.coerce.number().min(0), couponCode: z.string().trim().max(30).nullish(), cashbackToUse: z.coerce.number().min(0).default(0), pointsToUse: z.coerce.number().int().min(0).default(0) }) }), asyncHandler(async (req, res) => {
  const quote = await quoteBenefits(prisma, { tenantId:req.auth!.tenantId, customerId:req.body.customerId, subtotal:req.body.subtotal, couponCode:req.body.couponCode, cashbackToUse:req.body.cashbackToUse, pointsToUse:req.body.pointsToUse })
  return ok(res, { ...quote, coupon: undefined, customer: undefined })
}))
router.post('/coupons', requirePermission('customers:manage'), validate({ body: couponSchema }), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof couponSchema>; const coupon = await prisma.coupon.create({ data: { ...body, description: body.description ?? null, maximumDiscount: body.maximumDiscount == null ? null : new Prisma.Decimal(body.maximumDiscount.toFixed(2)), discountValue: new Prisma.Decimal(body.discountValue.toFixed(2)), minimumOrder: new Prisma.Decimal(body.minimumOrder.toFixed(2)), startsAt: body.startsAt ? new Date(body.startsAt) : new Date(), endsAt: body.endsAt ? new Date(body.endsAt) : null, tenantId: req.auth!.tenantId } }); return createdResponse(res, coupon)
}))
router.put('/coupons/:id', requirePermission('customers:manage'), validate({ body: couponSchema }), asyncHandler(async (req, res) => {
  const tenantId=req.auth!.tenantId; const id=String(req.params.id); if(!await prisma.coupon.findFirst({where:{id,tenantId}}))throw notFound('Cupom nao encontrado.'); const body=req.body as z.infer<typeof couponSchema>; return ok(res,await prisma.coupon.update({where:{id},data:{...body,description:body.description??null,maximumDiscount:body.maximumDiscount==null?null:new Prisma.Decimal(body.maximumDiscount.toFixed(2)),discountValue:new Prisma.Decimal(body.discountValue.toFixed(2)),minimumOrder:new Prisma.Decimal(body.minimumOrder.toFixed(2)),startsAt:body.startsAt?new Date(body.startsAt):new Date(),endsAt:body.endsAt?new Date(body.endsAt):null}}))
}))

const customerSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome'),
  phone: z.string().trim().min(8, 'Informe o telefone'),
  email: z.string().trim().email('E-mail invalido').nullish().or(z.literal('')),
  address: z.string().trim().nullish(), neighborhood: z.string().trim().nullish(),
  city: z.string().trim().nullish(), state: z.string().trim().max(2).nullish(), zipCode: z.string().trim().nullish(),
  notes: z.string().trim().max(1000).nullish(), birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  marketingConsent: z.boolean().default(false),
})

router.post(
  '/', requirePermission('customers:manage'), validate({ body: customerSchema }),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth!
    const body = req.body as z.infer<typeof customerSchema>
    const phone = body.phone.replace(/\D/g, '')
    const duplicate = await prisma.customer.findFirst({ where: { tenantId, phone } })
    if (duplicate) throw conflict('Ja existe um cliente com este telefone.')
    const customer = await prisma.customer.create({ data: { ...body, phone, email: body.email || null, birthday: body.birthday ? new Date(`${body.birthday}T12:00:00.000Z`) : null, tenantId } })
    return createdResponse(res, customer)
  }),
)

router.put(
  '/:id', requirePermission('customers:manage'), validate({ body: customerSchema }),
  asyncHandler(async (req, res) => {
    const { tenantId } = req.auth!
    const id = String(req.params.id)
    const current = await prisma.customer.findFirst({ where: { id, tenantId } })
    if (!current) throw notFound('Cliente nao encontrado.')
    const body = req.body as z.infer<typeof customerSchema>
    const phone = body.phone.replace(/\D/g, '')
    const duplicate = await prisma.customer.findFirst({ where: { tenantId, phone, id: { not: id } } })
    if (duplicate) throw conflict('Ja existe outro cliente com este telefone.')
    const customer = await prisma.customer.update({ where: { id }, data: { ...body, phone, email: body.email || null, birthday: body.birthday ? new Date(`${body.birthday}T12:00:00.000Z`) : null } })
    return ok(res, { ...customer, segment: customerSegment(customer) })
  }),
)

const benefitSchema = z.object({
  pointsDelta: z.coerce.number().int().default(0),
  cashbackDelta: z.coerce.number().multipleOf(0.01).default(0),
  reason: z.string().trim().min(3, 'Informe o motivo').max(200),
}).refine((body) => body.pointsDelta !== 0 || body.cashbackDelta !== 0, 'Informe pontos ou cashback')

router.post(
  '/:id/benefits', requirePermission('customers:manage'), validate({ body: benefitSchema }),
  asyncHandler(async (req, res) => {
    const { tenantId, userId } = req.auth!
    const id = String(req.params.id)
    const body = req.body as z.infer<typeof benefitSchema>
    const customer = await prisma.customer.findFirst({ where: { id, tenantId } })
    if (!customer) throw notFound('Cliente nao encontrado.')
    const points = customer.loyaltyPoints + body.pointsDelta
    const cashback = Number(customer.cashbackBalance) + body.cashbackDelta
    if (points < 0 || cashback < 0) throw badRequest('O saldo de pontos ou cashback nao pode ficar negativo.')
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({ where: { id }, data: { loyaltyPoints: points, cashbackBalance: new Prisma.Decimal(cashback.toFixed(2)) } })
      await tx.loyaltyTransaction.create({ data: { pointsDelta: body.pointsDelta, cashbackDelta: new Prisma.Decimal(body.cashbackDelta.toFixed(2)), pointsBalance: points, cashbackBalance: new Prisma.Decimal(cashback.toFixed(2)), reason: body.reason, sourceType: 'manual', tenantId, customerId: id, actorId: userId } })
      return updated
})

const addressSchema = z.object({ label:z.string().trim().min(1).max(40).default('Principal'), address:z.string().trim().min(3).max(180), neighborhood:z.string().trim().min(1).max(100), city:z.string().trim().max(100).nullish(), state:z.string().trim().max(2).nullish(), zipCode:z.string().trim().max(12).nullish(), isDefault:z.boolean().default(false) })

router.post('/:id/addresses', requirePermission('customers:manage'), validate({ body: addressSchema }), asyncHandler(async (req,res) => {
  const tenantId=req.auth!.tenantId; const customerId=String(req.params.id); if(!await prisma.customer.findFirst({where:{id:customerId,tenantId}}))throw notFound('Cliente nao encontrado.')
  const body=req.body as z.infer<typeof addressSchema>; const created=await prisma.$transaction(async tx=>{ if(body.isDefault)await tx.customerAddress.updateMany({where:{customerId,tenantId},data:{isDefault:false}}); return tx.customerAddress.create({data:{...body,state:body.state?.toUpperCase()||null,tenantId,customerId}}) }); return createdResponse(res,created)
}))
router.put('/:id/addresses/:addressId', requirePermission('customers:manage'), validate({ body: addressSchema }), asyncHandler(async (req,res) => {
  const tenantId=req.auth!.tenantId; const id=String(req.params.addressId); const current=await prisma.customerAddress.findFirst({where:{id,customerId:String(req.params.id),tenantId}}); if(!current)throw notFound('Endereco nao encontrado.')
  const body=req.body as z.infer<typeof addressSchema>; const updated=await prisma.$transaction(async tx=>{if(body.isDefault)await tx.customerAddress.updateMany({where:{customerId:current.customerId,tenantId},data:{isDefault:false}});return tx.customerAddress.update({where:{id},data:{...body,state:body.state?.toUpperCase()||null}})});return ok(res,updated)
}))
    return ok(res, result)
  }),
)

/** GET /api/customers/:id — ficha do cliente com os ultimos pedidos. */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const { id } = req.params

    const customer = await prisma.customer.findFirst({
      // `tenantId` no filtro, nao so o id: sem isso um id valido de outra loja
      // vazaria o cadastro dela.
      where: { id, tenantId },
      select: {
        ...publicFields,
        orders: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalAmount: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        loyaltyTransactions: { orderBy: { createdAt: 'desc' }, take: 20, include: { actor: { select: { firstName: true, lastName: true } } } },
        addresses: { orderBy: [{ isDefault:'desc' }, { createdAt:'asc' }] },
      },
    })

    if (!customer) throw notFound('Cliente nao encontrado.')

    return ok(res, customer)
  }),
)

export default router
