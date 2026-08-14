import { randomBytes, randomUUID } from 'node:crypto'
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, badRequest, conflict, notFound, ok, requireAuth, serialize, tenantOf } from '../lib/http.js'
import { emitToTenant } from '../lib/realtime.js'
import { validate, z } from '../lib/validate.js'
import { geocodeAddress, optimizeStopOrder, routeBetween, type Coordinate } from '../services/routingService.js'

const router = Router()
const locationBody = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).max(10000).optional(),
  heading: z.coerce.number().min(0).max(360).optional(),
})

const queueInclude = {
  order: {
    select: {
      id: true, orderNumber: true, status: true, deliveryAddress: true, observations: true, publicToken: true,
      customer: { select: { name: true, phone: true, address: true, neighborhood: true, city: true, state: true, zipCode: true } },
      orderItems: { select: { quantity: true, observations: true, product: { select: { name: true } } } },
    },
  },
} as const

async function driverProfile(tenantId: string, userId: string) {
  const profile = await prisma.fleet.findFirst({ where: { tenantId, driverUserId: userId, active: true } })
  if (!profile) throw notFound('Seu cadastro de entregador nao esta ativo nesta loja.')
  return profile
}

function scanToken(raw: string): string {
  const value = raw.trim()
  if (value.startsWith('delione:delivery:')) return value.slice('delione:delivery:'.length)
  try { const url = new URL(value); return url.searchParams.get('token') ?? value } catch { return value }
}

async function queued(tenantId: string, userId: string) {
  return prisma.delivery.findMany({
    where: { tenantId, driverUserId: userId, status: { in: ['assigned', 'in_transit'] } },
    include: queueInclude,
    orderBy: [{ routePosition: 'asc' }, { assignedAt: 'asc' }],
  })
}

router.get('/queue', asyncHandler(async (req, res) => {
  const auth = requireAuth(req)
  const profile = await driverProfile(auth.tenantId, auth.userId)
  return ok(res, serialize({ profile, deliveries: await queued(auth.tenantId, auth.userId) }))
}))

router.post('/scan', validate({ body: z.object({ code: z.string().min(8).max(500) }) }), asyncHandler(async (req, res) => {
  const auth = requireAuth(req)
  const tenantId = tenantOf(req)
  const profile = await driverProfile(tenantId, auth.userId)
  const token = scanToken((req.body as { code: string }).code)
  const delivery = await prisma.delivery.findFirst({ where: { tenantId, pickupToken: token }, include: queueInclude })
  if (!delivery || (delivery.pickupTokenExpiresAt && delivery.pickupTokenExpiresAt < new Date())) throw notFound('QR Code invalido ou vencido.')
  if (delivery.order.status !== 'ready') throw conflict('Este pedido ainda nao foi liberado pela cozinha.', 'ORDER_NOT_READY')
  if (delivery.status === 'delivered') throw conflict('Este pedido ja foi entregue.', 'DELIVERY_ALREADY_DONE')
  if (delivery.driverUserId && delivery.driverUserId !== auth.userId) throw conflict('Este pedido ja esta com outro entregador.', 'DELIVERY_ALREADY_ASSIGNED')
  if (delivery.driverUserId === auth.userId) return ok(res, serialize(delivery))

  const current = await queued(tenantId, auth.userId)
  if (current.some((item) => item.status === 'in_transit')) throw conflict('Conclua a rota atual antes de adicionar outro pedido.', 'ROUTE_ALREADY_STARTED')
  const batchId = current[0]?.routeBatchId ?? randomUUID()
  const position = current.reduce((max, item) => Math.max(max, item.routePosition ?? 0), 0) + 1
  const updated = await prisma.$transaction(async (tx) => {
    await tx.delivery.update({ where: { id: delivery.id }, data: {
      status: 'assigned', courierId: profile.id, driverUserId: auth.userId, assignedToId: auth.userId,
      assignedAt: new Date(), routeBatchId: batchId, routePosition: position,
      deliveryCode: delivery.deliveryCode ?? String(Math.floor(1000 + Math.random() * 9000)),
    } })
    return tx.delivery.findUniqueOrThrow({ where: { id: delivery.id }, include: queueInclude })
  })
  emitToTenant(tenantId, 'delivery:updated', serialize(updated))
  return ok(res, serialize(updated))
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const auth = requireAuth(req)
  const delivery = await prisma.delivery.findFirst({ where: { id: req.params.id, tenantId: auth.tenantId, driverUserId: auth.userId }, include: queueInclude })
  if (!delivery) throw notFound('Pedido nao encontrado na sua fila.')
  if (delivery.status !== 'assigned' || delivery.routeStartedAt) throw conflict('Uma rota iniciada nao pode remover paradas.', 'ROUTE_STARTED')
  const updated = await prisma.delivery.update({ where: { id: delivery.id }, data: {
    status: 'awaiting_assignment', courierId: null, driverUserId: null, assignedToId: null, assignedAt: null,
    routeBatchId: null, routePosition: null, estimatedArrivalAt: null,
  } })
  emitToTenant(auth.tenantId, 'delivery:updated', serialize(updated))
  return ok(res, { removed: true })
}))

async function ensureCoordinates(deliveries: Awaited<ReturnType<typeof queued>>) {
  for (const delivery of deliveries) {
    if (delivery.destinationLatitude != null && delivery.destinationLongitude != null) continue
    const address = delivery.order.deliveryAddress || delivery.order.customer?.address
    if (!address) throw badRequest(`O pedido #${delivery.order.orderNumber} nao possui endereco.`)
    const coordinate = await geocodeAddress(address)
    if (!coordinate) throw badRequest(`Nao localizamos o endereco do pedido #${delivery.order.orderNumber}. Revise o cadastro antes de sair.`)
    delivery.destinationLatitude = coordinate.latitude
    delivery.destinationLongitude = coordinate.longitude
    await prisma.delivery.update({ where: { id: delivery.id }, data: { destinationLatitude: coordinate.latitude, destinationLongitude: coordinate.longitude } })
  }
}

async function createPlan(tenantId: string, userId: string, current: Coordinate, shouldStart: boolean) {
  const profile = await driverProfile(tenantId, userId)
  let deliveries = await queued(tenantId, userId)
  if (!deliveries.length) throw badRequest('Leia pelo menos um QR Code antes de montar a rota.')
  await ensureCoordinates(deliveries)
  const alreadyStarted = deliveries.some((item) => item.status === 'in_transit')
  if (!alreadyStarted) {
    const indexes = await optimizeStopOrder(current, deliveries.map((item) => ({ latitude: item.destinationLatitude!, longitude: item.destinationLongitude! })))
    deliveries = indexes.map((index) => deliveries[index]!)
  }
  const route = await routeBetween([current, ...deliveries.map((item) => ({ latitude: item.destinationLatitude!, longitude: item.destinationLongitude! }))])
  const now = new Date()
  let cumulative = 0
  await prisma.$transaction(async (tx) => {
    for (const [index, delivery] of deliveries.entries()) {
      cumulative += route.legs[index]?.duration ?? 0
      delivery.routePosition = index + 1
      delivery.estimatedArrivalAt = new Date(now.getTime() + cumulative * 1000)
      await tx.delivery.update({ where: { id: delivery.id }, data: {
        routePosition: index + 1, estimatedArrivalAt: delivery.estimatedArrivalAt,
        ...(shouldStart ? { status: 'in_transit', pickedUpAt: delivery.pickedUpAt ?? now, routeStartedAt: delivery.routeStartedAt ?? now } : {}),
      } })
      if (shouldStart) await tx.order.update({ where: { id: delivery.orderId }, data: { status: 'dispatched' } })
    }
    if (shouldStart) await tx.fleet.update({ where: { id: profile.id }, data: { availability: 'busy', currentLatitude: current.latitude, currentLongitude: current.longitude, locationUpdatedAt: now } })
  })
  const result = { deliveries, route, currentLocation: current }
  emitToTenant(tenantId, 'delivery:updated', serialize({ kind: shouldStart ? 'route_started' : 'route_planned', ...result }))
  return result
}

router.post('/route/plan', validate({ body: locationBody }), asyncHandler(async (req, res) => {
  const auth = requireAuth(req); const body = req.body as z.infer<typeof locationBody>
  return ok(res, serialize(await createPlan(auth.tenantId, auth.userId, body, false)))
}))

router.post('/route/start', validate({ body: locationBody }), asyncHandler(async (req, res) => {
  const auth = requireAuth(req); const body = req.body as z.infer<typeof locationBody>
  return ok(res, serialize(await createPlan(auth.tenantId, auth.userId, body, true)))
}))

router.post('/location', validate({ body: locationBody }), asyncHandler(async (req, res) => {
  const auth = requireAuth(req); const body = req.body as z.infer<typeof locationBody>
  const profile = await driverProfile(auth.tenantId, auth.userId)
  await prisma.fleet.update({ where: { id: profile.id }, data: {
    currentLatitude: body.latitude, currentLongitude: body.longitude, locationAccuracy: body.accuracy,
    locationHeading: body.heading, locationUpdatedAt: new Date(),
  } })
  const deliveries = await queued(auth.tenantId, auth.userId)
  let plan = null
  if (deliveries.some((item) => item.status === 'in_transit')) plan = await createPlan(auth.tenantId, auth.userId, body, false)
  emitToTenant(auth.tenantId, 'delivery:updated', serialize({ kind: 'driver_location', driverId: profile.id, ...body, updatedAt: new Date() }))
  return ok(res, serialize(plan ?? { updated: true }))
}))

router.patch('/:id/complete', asyncHandler(async (req, res) => {
  const auth = requireAuth(req)
  const delivery = await prisma.delivery.findFirst({ where: { id: req.params.id, tenantId: auth.tenantId, driverUserId: auth.userId }, include: queueInclude })
  if (!delivery) throw notFound('Parada nao encontrada.')
  if (delivery.status !== 'in_transit') throw conflict('Inicie a rota antes de concluir.', 'ROUTE_NOT_STARTED')
  const now = new Date()
  const updated = await prisma.$transaction(async (tx) => {
    await tx.delivery.update({ where: { id: delivery.id }, data: { status: 'delivered', actualTime: now, recipientName: delivery.order.customer?.name ?? 'Cliente' } })
    await tx.order.update({ where: { id: delivery.orderId }, data: { status: 'delivered', deliveredAt: now } })
    await tx.orderEvent.create({ data: { tenantId: auth.tenantId, orderId: delivery.orderId, actorId: auth.userId, type: 'delivery_proof', fromStatus: 'dispatched', toStatus: 'delivered', note: 'Entrega concluida pelo entregador.' } })
    const remaining = await tx.delivery.count({ where: { tenantId: auth.tenantId, driverUserId: auth.userId, status: 'in_transit' } })
    if (remaining === 0 && delivery.courierId) await tx.fleet.update({ where: { id: delivery.courierId }, data: { availability: 'available' } })
    return tx.delivery.findUniqueOrThrow({ where: { id: delivery.id }, include: queueInclude })
  })
  emitToTenant(auth.tenantId, 'delivery:updated', serialize(updated))
  emitToTenant(auth.tenantId, 'order:status', serialize(updated.order))
  return ok(res, serialize(updated))
}))

export default router
