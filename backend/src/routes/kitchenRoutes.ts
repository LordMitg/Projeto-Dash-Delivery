import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import {
  asyncHandler,
  badRequest,
  conflict,
  notFound,
  ok,
  requireAuth,
  serialize,
  tenantOf,
} from '../lib/http.js'
import { emitToTenant } from '../lib/realtime.js'
import { validate, z } from '../lib/validate.js'

const router = Router()

const paramsSchema = z.object({
  orderId: z.string().min(1),
  itemId: z.string().min(1),
})

const orderParamSchema = z.object({ orderId: z.string().min(1) })

const orderInclude = {
  customer: { select: { id: true, name: true, phone: true } },
  salesChannel: { select: { id: true, name: true, slug: true } },
  orderItems: {
    orderBy: { id: 'asc' as const },
    include: {
      product: {
        select: { id: true, name: true, imageUrl: true, category: true },
      },
    },
  },
} as const

/** Fila operacional: pedidos finalizados e cancelados nunca voltam para o KDS. */
router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const orders = await prisma.order.findMany({
      where: {
        tenantId,
        OR: [
          { status: { in: ['pending', 'confirmed', 'preparing'] } },
          {
            status: 'ready',
            OR: [
              { orderType: { not: 'delivery' } },
              { delivery: { is: null } },
              { delivery: { is: { status: 'pending' } } },
            ],
          },
        ],
      },
      include: orderInclude,
      orderBy: [{ priority: 'desc' }, { prioritizedAt: 'asc' }, { createdAt: 'asc' }],
    })
    return ok(res, orders)
  }),
)

/**
 * Move somente um item. O pedido entra em preparo quando a primeira estacao
 * comeca e fica pronto apenas depois que TODAS as estacoes terminam.
 */
router.patch(
  '/orders/:orderId/items/:itemId/status',
  validate({
    params: paramsSchema,
    body: z.object({ status: z.enum(['preparing', 'ready']) }),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const auth = requireAuth(req)
    const { orderId, itemId } = req.params as { orderId: string; itemId: string }
    const { status } = req.body as { status: 'preparing' | 'ready' }

    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { orderItems: true },
    })
    if (!order) throw notFound('Pedido nao encontrado.')
    if (['cancelled', 'dispatched', 'delivered'].includes(order.status)) {
      throw conflict('Este pedido ja saiu da fila de producao.', 'ORDER_CLOSED')
    }

    const item = order.orderItems.find((entry) => entry.id === itemId)
    if (!item) throw notFound('Item de producao nao encontrado.')
    if (item.productionStatus === status) return ok(res, { orderId, itemId, status })

    const allowed =
      (item.productionStatus === 'pending' && status === 'preparing') ||
      (item.productionStatus === 'preparing' && status === 'ready')
    if (!allowed) {
      throw conflict(
        `Nao e possivel mudar o item de "${item.productionStatus}" para "${status}".`,
        'INVALID_ITEM_TRANSITION',
      )
    }

    const now = new Date()
    const allReady = order.orderItems.every((entry) =>
      entry.id === itemId ? status === 'ready' : entry.productionStatus === 'ready',
    )
    const nextOrderStatus = allReady
      ? 'ready'
      : status === 'preparing' && ['pending', 'confirmed'].includes(order.status)
        ? 'preparing'
        : order.status

    const updated = await prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          productionStatus: status,
          ...(status === 'preparing' ? { startedAt: item.startedAt ?? now } : {}),
          ...(status === 'ready' ? { readyAt: now } : {}),
        },
      })

      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          actorId: auth.userId,
          type: 'production',
          fromStatus: item.productionStatus,
          toStatus: status,
          note: `${item.preparationStation} · item ${item.id}`,
        },
      })

      if (nextOrderStatus !== order.status) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: nextOrderStatus },
        })
        await tx.orderEvent.create({
          data: {
            tenantId,
            orderId: order.id,
            actorId: auth.userId,
            type: 'status',
            fromStatus: order.status,
            toStatus: nextOrderStatus,
            note: allReady ? 'Todas as estacoes finalizaram.' : 'Primeiro item iniciado.',
          },
        })
      }

      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude })
    })

    const payload = serialize(updated)
    emitToTenant(tenantId, 'order:item-status', payload)
    if (nextOrderStatus !== order.status) emitToTenant(tenantId, 'order:status', payload)
    return ok(res, payload)
  }),
)

/** Prioridade manual, sempre com justificativa para nao virar um fura-fila invisivel. */
router.patch(
  '/orders/:orderId/priority',
  validate({
    params: orderParamSchema,
    body: z.discriminatedUnion('priority', [
      z.object({ priority: z.literal(true), reason: z.string().trim().min(3).max(160) }),
      z.object({ priority: z.literal(false), reason: z.string().trim().max(160).optional() }),
    ]),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const auth = requireAuth(req)
    const { orderId } = req.params as { orderId: string }
    const body = req.body as { priority: boolean; reason?: string }
    const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } })
    if (!order) throw notFound('Pedido nao encontrado.')
    if (['cancelled', 'dispatched', 'delivered'].includes(order.status)) {
      throw conflict('Pedido finalizado nao pode mudar de prioridade.', 'ORDER_CLOSED')
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          actorId: auth.userId,
          type: 'priority',
          fromStatus: order.priority ? 'priority' : 'normal',
          toStatus: body.priority ? 'priority' : 'normal',
          note: body.reason || (body.priority ? 'Prioridade operacional.' : 'Prioridade removida.'),
        },
      })
      await tx.order.update({
        where: { id: order.id },
        data: {
          priority: body.priority,
          priorityReason: body.priority ? body.reason : null,
          prioritizedAt: body.priority ? new Date() : null,
        },
      })
      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude })
    })
    const payload = serialize(updated)
    emitToTenant(tenantId, 'order:priority', payload)
    return ok(res, payload)
  }),
)

/**
 * Corrige um item marcado pronto por engano. Exige motivo, zera o horario de
 * conclusao e devolve o pedido geral para preparando quando necessario.
 */
router.patch(
  '/orders/:orderId/items/:itemId/reopen',
  validate({
    params: paramsSchema,
    body: z.object({ reason: z.string().trim().min(3).max(200) }),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const auth = requireAuth(req)
    const { orderId, itemId } = req.params as { orderId: string; itemId: string }
    const { reason } = req.body as { reason: string }
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { orderItems: { include: { product: { select: { name: true } } } } },
    })
    if (!order) throw notFound('Pedido nao encontrado.')
    if (!['preparing', 'ready'].includes(order.status)) {
      throw conflict('Somente pedidos em producao ou prontos podem ser reabertos.', 'ORDER_NOT_REOPENABLE')
    }
    const item = order.orderItems.find((entry) => entry.id === itemId)
    if (!item) throw notFound('Item de producao nao encontrado.')
    if (item.productionStatus !== 'ready') {
      throw conflict('Somente um item pronto pode ser reaberto.', 'ITEM_NOT_READY')
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: item.id },
        data: { productionStatus: 'preparing', readyAt: null, startedAt: new Date() },
      })
      if (order.status === 'ready') {
        await tx.order.update({ where: { id: order.id }, data: { status: 'preparing' } })
      }
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          actorId: auth.userId,
          type: 'production_reopened',
          fromStatus: 'ready',
          toStatus: 'preparing',
          note: `${item.preparationStation} · ${item.product.name} · ${reason}`,
        },
      })
      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude })
    })
    const payload = serialize(updated)
    emitToTenant(tenantId, 'order:item-status', payload)
    emitToTenant(tenantId, 'order:status', payload)
    return ok(res, payload)
  }),
)

/** Registra quais itens de uma estacao foram enviados ao dialogo de impressao. */
router.patch(
  '/orders/:orderId/print',
  validate({
    params: orderParamSchema,
    body: z.object({ station: z.string().trim().min(1).max(80) }),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const auth = requireAuth(req)
    const { orderId } = req.params as { orderId: string }
    const { station } = req.body as { station: string }
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { orderItems: true },
    })
    if (!order) throw notFound('Pedido nao encontrado.')
    const stationItems = order.orderItems.filter((item) => item.preparationStation === station)
    if (!stationItems.length) throw badRequest('Este pedido nao possui itens nesta estacao.')

    const now = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.orderItem.updateMany({
        where: { orderId: order.id, preparationStation: station },
        data: { printedAt: now },
      })
      await tx.order.update({ where: { id: order.id }, data: { printedKitchen: true } })
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          actorId: auth.userId,
          type: 'kitchen_printed',
          note: `${station} · ${stationItems.length} item(ns)`,
        },
      })
    })
    emitToTenant(tenantId, 'order:kitchen-printed', { orderId, station, printedAt: now })
    return ok(res, { orderId, station, printedAt: now })
  }),
)

/** Expede o pedido somente quando nenhum item ficou pendente na cozinha. */
router.patch(
  '/orders/:orderId/dispatch',
  validate({ params: orderParamSchema }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const auth = requireAuth(req)
    const { orderId } = req.params as { orderId: string }
    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { orderItems: true },
    })
    if (!order) throw notFound('Pedido nao encontrado.')
    if (order.status !== 'ready') throw conflict('O pedido ainda nao esta pronto.', 'ORDER_NOT_READY')
    if (order.orderItems.some((item) => item.productionStatus !== 'ready')) {
      throw badRequest('Ainda existem itens pendentes em outra estacao.')
    }

    const nextStatus = order.orderType === 'delivery' ? 'ready' : 'delivered'
    const now = new Date()
    const updated = await prisma.$transaction(async (tx) => {
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          actorId: auth.userId,
          type: order.orderType === 'delivery' ? 'delivery_queue' : 'status',
          fromStatus: order.status,
          toStatus: nextStatus,
          note: order.orderType === 'delivery' ? 'Pedido enviado para a fila de expedicao.' : 'Pedido entregue ao cliente.',
        },
      })
      if (order.orderType === 'delivery') {
        await tx.delivery.upsert({
          where: { orderId: order.id },
          create: { orderId: order.id, tenantId, status: 'awaiting_assignment' },
          update: { status: 'awaiting_assignment' },
        })
      }
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: nextStatus,
          ...(nextStatus === 'delivered' ? { deliveredAt: now } : {}),
        },
      })
      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude })
    })

    const payload = serialize(updated)
    emitToTenant(tenantId, order.orderType === 'delivery' ? 'delivery:updated' : 'order:status', payload)
    return ok(res, payload)
  }),
)

export default router
