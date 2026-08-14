import { randomBytes, randomInt } from 'node:crypto'
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import {
  asyncHandler,
  badRequest,
  conflict,
  createdResponse,
  notFound,
  ok,
  requireAuth,
  serialize,
  tenantOf,
} from '../lib/http.js'
import { emitToTenant } from '../lib/realtime.js'
import { validate, z } from '../lib/validate.js'

const router = Router()
const idParams = z.object({ id: z.string().min(1) })
const vehicleTypes = ['moto', 'carro', 'bicicleta', 'a_pe'] as const

const boardInclude = {
  courier: {
    select: {
      id: true,
      name: true,
      phone: true,
      vehicleType: true,
      plate: true,
      availability: true,
    },
  },
  order: {
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          address: true,
          neighborhood: true,
          city: true,
          state: true,
          zipCode: true,
        },
      },
      orderItems: {
        select: {
          id: true,
          quantity: true,
          observations: true,
          product: { select: { name: true } },
        },
      },
    },
  },
} as const

const courierBody = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(24).optional().default(''),
  vehicleType: z.enum(vehicleTypes).default('moto'),
  plate: z.string().trim().max(12).optional().default(''),
  deliveryFee: z.coerce.number().min(0).max(99999).default(0),
})

/** Fila de expedicao e entregas do dia. Sem coordenadas, nao inventamos GPS. */
router.get(
  '/board',
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const start = new Date()
    start.setHours(0, 0, 0, 0)

    const [deliveries, couriers] = await Promise.all([
      prisma.delivery.findMany({
        where: {
          tenantId,
          OR: [
            { status: { in: ['pending', 'awaiting_assignment', 'assigned', 'in_transit', 'failed'] } },
            { status: 'delivered', actualTime: { gte: start } },
          ],
        },
        include: boardInclude,
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.fleet.findMany({
        where: { tenantId, active: true },
        orderBy: [{ availability: 'asc' }, { name: 'asc' }],
      }),
    ])

    const waiting = deliveries.filter((entry) =>
      ['pending', 'awaiting_assignment', 'assigned'].includes(entry.status),
    ).length
    const inTransit = deliveries.filter((entry) => entry.status === 'in_transit').length
    const deliveredToday = deliveries.filter((entry) => entry.status === 'delivered').length
    const available = couriers.filter((entry) => entry.availability === 'available').length

    return ok(res, serialize({
      summary: { waiting, inTransit, deliveredToday, available, totalCouriers: couriers.length },
      deliveries,
      couriers,
    }))
  }),
)

/** QR de retirada: so o entregador autenticado da mesma loja consegue troca-lo por dados. */
router.get('/:id/pickup-code', asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req)
  const delivery = await prisma.delivery.findFirst({ where: { id: req.params.id, tenantId }, include: { order: { select: { orderNumber: true, status: true } } } })
  if (!delivery) throw notFound('Entrega nao encontrada.')
  if (!['ready', 'dispatched'].includes(delivery.order.status)) throw conflict('O QR fica disponivel quando a cozinha liberar o pedido.', 'ORDER_NOT_READY')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const token = delivery.pickupToken && (!delivery.pickupTokenExpiresAt || delivery.pickupTokenExpiresAt > now)
    ? delivery.pickupToken
    : randomBytes(24).toString('base64url')
  if (token !== delivery.pickupToken) await prisma.delivery.update({ where: { id: delivery.id }, data: { pickupToken: token, pickupTokenExpiresAt: expiresAt } })
  return ok(res, { orderNumber: delivery.order.orderNumber, payload: `delione:delivery:${token}`, expiresAt })
}))

router.post(
  '/couriers',
  validate({ body: courierBody }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const body = req.body as z.infer<typeof courierBody>
    const courier = await prisma.fleet.create({
      data: {
        tenantId,
        name: body.name,
        phone: body.phone || null,
        vehicleType: body.vehicleType,
        plate: body.plate ? body.plate.toUpperCase() : null,
        deliveryFee: body.deliveryFee,
        availability: 'available',
      },
    })
    emitToTenant(tenantId, 'delivery:updated', serialize({ kind: 'courier_created', courier }))
    return createdResponse(res, courier)
  }),
)

router.patch(
  '/couriers/:id',
  validate({
    params: idParams,
    body: z.object({
      availability: z.enum(['available', 'offline']).optional(),
      active: z.boolean().optional(),
    }).refine((value) => Object.keys(value).length > 0),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const { id } = req.params as { id: string }
    const body = req.body as { availability?: 'available' | 'offline'; active?: boolean }
    const courier = await prisma.fleet.findFirst({ where: { id, tenantId } })
    if (!courier) throw notFound('Entregador nao encontrado.')
    if (courier.availability === 'busy') {
      throw conflict('Finalize ou remova a entrega antes de alterar este entregador.', 'COURIER_BUSY')
    }
    const updated = await prisma.fleet.update({ where: { id }, data: body })
    emitToTenant(tenantId, 'delivery:updated', serialize({ kind: 'courier_updated', courier: updated }))
    return ok(res, updated)
  }),
)

router.patch(
  '/:id/assign',
  validate({
    params: idParams,
    body: z.discriminatedUnion('dispatchMode', [
      z.object({ dispatchMode: z.literal('own_fleet'), courierId: z.string().min(1) }),
      z.object({ dispatchMode: z.literal('external'), externalCourierName: z.string().trim().min(2).max(100) }),
      z.object({ dispatchMode: z.literal('manual') }),
    ]),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const auth = requireAuth(req)
    const { id } = req.params as { id: string }
    const body = req.body as
      | { dispatchMode: 'own_fleet'; courierId: string }
      | { dispatchMode: 'external'; externalCourierName: string }
      | { dispatchMode: 'manual' }

    const delivery = await prisma.delivery.findFirst({
      where: { id, tenantId },
      include: { order: { select: { id: true, orderNumber: true, status: true } } },
    })
    if (!delivery) throw notFound('Entrega nao encontrada.')
    if (!['pending', 'awaiting_assignment'].includes(delivery.status)) {
      throw conflict('Esta entrega nao esta aguardando atribuicao.', 'DELIVERY_NOT_WAITING')
    }
    if (delivery.order.status !== 'ready') {
      throw conflict('A cozinha ainda nao liberou este pedido.', 'ORDER_NOT_READY')
    }

    const now = new Date()
    const updated = await prisma.$transaction(async (tx) => {
      if (body.dispatchMode === 'own_fleet') {
        const claimed = await tx.fleet.updateMany({
          where: { id: body.courierId, tenantId, active: true, availability: 'available' },
          data: { availability: 'busy' },
        })
        if (claimed.count !== 1) {
          throw conflict('Este entregador nao esta disponivel.', 'COURIER_UNAVAILABLE')
        }
      }
      await tx.delivery.update({
        where: { id },
        data: {
          status: 'assigned',
          dispatchMode: body.dispatchMode,
          courierId: body.dispatchMode === 'own_fleet' ? body.courierId : null,
          externalCourierName: body.dispatchMode === 'external' ? body.externalCourierName : null,
          assignedToId: auth.userId,
          assignedAt: now,
          deliveryCode: delivery.deliveryCode ?? String(randomInt(1000, 10000)),
        },
      })
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId: delivery.orderId,
          actorId: auth.userId,
          type: 'delivery_assigned',
          fromStatus: delivery.status,
          toStatus: 'assigned',
          note: body.dispatchMode === 'own_fleet'
            ? `Frota propria · ${body.courierId}`
            : body.dispatchMode === 'external'
              ? `Entrega externa · ${body.externalCourierName}`
              : 'Entrega sem entregador cadastrado',
        },
      })
      return tx.delivery.findUniqueOrThrow({ where: { id }, include: boardInclude })
    })
    emitToTenant(tenantId, 'delivery:updated', serialize(updated))
    return ok(res, updated)
  }),
)

router.patch(
  '/:id/unassign',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const auth = requireAuth(req)
    const { id } = req.params as { id: string }
    const delivery = await prisma.delivery.findFirst({ where: { id, tenantId } })
    if (!delivery) throw notFound('Entrega nao encontrada.')
    if (delivery.status !== 'assigned') {
      throw conflict('Esta entrega nao possui atribuicao removivel.', 'DELIVERY_NOT_ASSIGNED')
    }
    const updated = await prisma.$transaction(async (tx) => {
      if (delivery.courierId) {
        await tx.fleet.update({ where: { id: delivery.courierId }, data: { availability: 'available' } })
      }
      await tx.delivery.update({
        where: { id },
        data: { status: 'awaiting_assignment', courierId: null, assignedToId: null, assignedAt: null, externalCourierName: null, dispatchMode: 'own_fleet' },
      })
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId: delivery.orderId,
          actorId: auth.userId,
          type: 'delivery_unassigned',
          fromStatus: 'assigned',
          toStatus: 'awaiting_assignment',
        },
      })
      return tx.delivery.findUniqueOrThrow({ where: { id }, include: boardInclude })
    })
    emitToTenant(tenantId, 'delivery:updated', serialize(updated))
    return ok(res, updated)
  }),
)

router.patch(
  '/:id/pickup',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const auth = requireAuth(req)
    const { id } = req.params as { id: string }
    const delivery = await prisma.delivery.findFirst({
      where: { id, tenantId },
      include: { order: { select: { id: true, status: true } } },
    })
    if (!delivery) throw notFound('Entrega nao encontrada.')
    if (delivery.status !== 'assigned') {
      throw conflict('Defina a forma de despacho antes da saida.', 'DELIVERY_NOT_ASSIGNED')
    }
    if (delivery.order.status !== 'ready') {
      throw conflict('O pedido nao esta pronto para sair.', 'ORDER_NOT_READY')
    }
    const now = new Date()
    const updated = await prisma.$transaction(async (tx) => {
      await tx.delivery.update({ where: { id }, data: { status: 'in_transit', pickedUpAt: now } })
      await tx.order.update({ where: { id: delivery.orderId }, data: { status: 'dispatched' } })
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId: delivery.orderId,
          actorId: auth.userId,
          type: 'status',
          fromStatus: 'ready',
          toStatus: 'dispatched',
          note: delivery.courierId ? 'Entregador confirmou a retirada.' : 'Pedido liberado para entrega sem entregador cadastrado.',
        },
      })
      return tx.delivery.findUniqueOrThrow({ where: { id }, include: boardInclude })
    })
    const payload = serialize(updated)
    emitToTenant(tenantId, 'delivery:updated', payload)
    emitToTenant(tenantId, 'order:status', payload.order)
    return ok(res, payload)
  }),
)

router.patch(
  '/:id/complete',
  validate({
    params: idParams,
    body: z.object({
      deliveryCode: z.string().regex(/^\d{4}$/, 'Informe o codigo de 4 digitos.'),
      recipientName: z.string().trim().min(2).max(100),
      proofNotes: z.string().trim().max(300).optional().default(''),
    }),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const auth = requireAuth(req)
    const { id } = req.params as { id: string }
    const body = req.body as { deliveryCode: string; recipientName: string; proofNotes: string }
    const delivery = await prisma.delivery.findFirst({ where: { id, tenantId } })
    if (!delivery) throw notFound('Entrega nao encontrada.')
    if (delivery.status !== 'in_transit') {
      throw conflict('Somente uma entrega em rota pode ser concluida.', 'DELIVERY_NOT_IN_TRANSIT')
    }
    if (!delivery.deliveryCode || body.deliveryCode !== delivery.deliveryCode) {
      throw badRequest('Codigo de entrega incorreto.', 'INVALID_DELIVERY_CODE')
    }
    const now = new Date()
    const updated = await prisma.$transaction(async (tx) => {
      if (delivery.courierId) {
        await tx.fleet.update({ where: { id: delivery.courierId }, data: { availability: 'available' } })
      }
      await tx.delivery.update({
        where: { id },
        data: {
          status: 'delivered',
          actualTime: now,
          recipientName: body.recipientName,
          proofNotes: body.proofNotes || null,
        },
      })
      await tx.order.update({ where: { id: delivery.orderId }, data: { status: 'delivered', deliveredAt: now } })
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId: delivery.orderId,
          actorId: auth.userId,
          type: 'delivery_proof',
          fromStatus: 'dispatched',
          toStatus: 'delivered',
          note: `Recebido por ${body.recipientName}${body.proofNotes ? ` · ${body.proofNotes}` : ''}`,
        },
      })
      return tx.delivery.findUniqueOrThrow({ where: { id }, include: boardInclude })
    })
    const payload = serialize(updated)
    emitToTenant(tenantId, 'delivery:updated', payload)
    emitToTenant(tenantId, 'order:status', payload.order)
    return ok(res, payload)
  }),
)

export default router
