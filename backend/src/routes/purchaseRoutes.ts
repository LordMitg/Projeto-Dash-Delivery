import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, badRequest, conflict, createdResponse, forbidden, notFound, ok, requireAuth, serialize, tenantOf } from '../lib/http.js'
import { hasPermission } from '../lib/permissions.js'
import { emitToTenant } from '../lib/realtime.js'
import { validate, z } from '../lib/validate.js'
import { buildCashSummary, findOpenRegister } from '../services/cashService.js'

const router = Router()
const dec = (value: number) => new Prisma.Decimal(value.toFixed(4))
const moneyDec = (value: number) => new Prisma.Decimal(value.toFixed(2))
const orderOmit = { receiptImageData: true } as const
const idParams = z.object({ id: z.string().min(1) })
function requireManage(req: Parameters<typeof requireAuth>[0]) {
  const auth = requireAuth(req)
  if (!hasPermission(auth.role, auth.permissions, 'purchases:manage')) throw forbidden('Voce nao tem permissao para alterar compras.')
  return auth
}
const orderInclude = {
  supplier: true,
  items: { include: { ingredient: { select: { id: true, name: true, unit: true, stock: true, price: true, minimumStock: true } } } },
  createdBy: { select: { firstName: true, lastName: true } },
  approvedBy: { select: { firstName: true, lastName: true } },
  receivedBy: { select: { firstName: true, lastName: true } },
  accountPayable: { select: { id: true, status: true, dueDate: true, amount: true, amountPaid: true, paidAt: true } },
  receipts: {
    include: {
      receivedBy: { select: { firstName: true, lastName: true } },
      items: { include: { purchaseOrderItem: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } } },
    },
    orderBy: { createdAt: 'desc' as const },
  },
} as const

router.get('/dashboard', asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req)
  const [suppliers, orders, ingredients] = await Promise.all([
    prisma.supplier.findMany({ where: { tenantId, active: true }, orderBy: { name: 'asc' } }),
    prisma.purchaseOrder.findMany({ where: { tenantId }, omit: orderOmit, include: orderInclude, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.ingredient.findMany({ where: { tenantId, active: true }, orderBy: { name: 'asc' } }),
  ])
  const openOrders = orders.filter((item) => !['received', 'cancelled'].includes(item.status))
  const lowStock = ingredients.filter((item) => Number(item.stock) <= Number(item.minimumStock))
  return ok(res, serialize({
    summary: {
      openAmount: openOrders.reduce((sum, item) => sum + Number(item.totalAmount), 0),
      awaitingApproval: orders.filter((item) => item.status === 'pending_approval').length,
      expected: orders.filter((item) => ['approved', 'ordered', 'partially_received'].includes(item.status)).length,
      lowStock: lowStock.length,
    },
    suppliers, orders, ingredients,
    suggestions: lowStock.map((item) => ({
      ingredientId: item.id, name: item.name, unit: item.unit, stock: item.stock, minimumStock: item.minimumStock,
      suggestedQuantity: Math.max(Number(item.minimumStock) * 2 - Number(item.stock), Number(item.minimumStock) || 1),
      lastUnitPrice: item.price,
    })),
  }))
}))

router.post('/suppliers', validate({ body: z.object({
  name: z.string().trim().min(2).max(160), document: z.string().trim().max(20).optional().default(''),
  contactName: z.string().trim().max(100).optional().default(''), phone: z.string().trim().max(24).optional().default(''),
  email: z.string().trim().email().optional().or(z.literal('')).default(''), paymentTermDays: z.coerce.number().int().min(0).max(365).default(0),
  notes: z.string().trim().max(500).optional().default(''),
}) }), asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req); requireManage(req)
  const body = req.body as { name: string; document: string; contactName: string; phone: string; email: string; paymentTermDays: number; notes: string }
  const supplier = await prisma.supplier.create({ data: {
    tenantId, name: body.name, document: body.document || null, contactName: body.contactName || null,
    phone: body.phone || null, email: body.email || null, paymentTermDays: body.paymentTermDays, notes: body.notes || null,
  } })
  emitToTenant(tenantId, 'purchase:updated', serialize({ kind: 'supplier_created', supplier }))
  return createdResponse(res, supplier)
}))

const orderBody = z.object({
  supplierId: z.string().min(1), expectedDeliveryDate: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(500).optional().default(''), submitForApproval: z.boolean().default(true),
  items: z.array(z.object({ ingredientId: z.string().min(1), orderedQuantity: z.coerce.number().positive().max(1000000),
    purchaseUnit: z.string().trim().min(1).max(20), conversionFactor: z.coerce.number().positive().max(1000000).default(1),
    unitPrice: z.coerce.number().min(0).max(1000000) })).min(1).max(100),
})

router.post('/orders', validate({ body: orderBody }), asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req); const auth = requireManage(req); const body = req.body as z.infer<typeof orderBody>
  const ingredientIds = [...new Set(body.items.map((item) => item.ingredientId))]
  if (ingredientIds.length !== body.items.length) throw badRequest('Cada insumo deve aparecer apenas uma vez no pedido.')
  const [supplier, ingredients, count] = await Promise.all([
    prisma.supplier.findFirst({ where: { id: body.supplierId, tenantId, active: true } }),
    prisma.ingredient.findMany({ where: { id: { in: ingredientIds }, tenantId, active: true } }),
    prisma.purchaseOrder.count({ where: { tenantId } }),
  ])
  if (!supplier) throw notFound('Fornecedor nao encontrado.')
  if (ingredients.length !== ingredientIds.length) throw badRequest('Um ou mais insumos nao existem nesta loja.')
  const total = body.items.reduce((sum, item) => sum + item.orderedQuantity * item.unitPrice, 0)
  const order = await prisma.purchaseOrder.create({ data: {
    tenantId, supplierId: supplier.id, createdById: auth.userId,
    orderNumber: `PC-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`,
    status: body.submitForApproval ? 'pending_approval' : 'draft', submittedAt: body.submitForApproval ? new Date() : null,
    expectedDeliveryDate: body.expectedDeliveryDate ?? null, notes: body.notes || null, totalAmount: dec(total),
    items: { create: body.items.map((item) => ({ ingredientId: item.ingredientId, orderedQuantity: dec(item.orderedQuantity),
      purchaseUnit: item.purchaseUnit, conversionFactor: dec(item.conversionFactor), unitPrice: dec(item.unitPrice),
      subtotal: dec(item.orderedQuantity * item.unitPrice) })) },
  }, omit: orderOmit, include: orderInclude })
  emitToTenant(tenantId, 'purchase:updated', serialize(order)); return createdResponse(res, order)
}))

const quickItemBody = z.object({
  ingredientId: z.string().min(1),
  quantity: z.coerce.number().positive().max(1000000),
  purchaseUnit: z.string().trim().min(1).max(20),
  conversionFactor: z.coerce.number().positive().max(1000000).default(1),
  unitPrice: z.coerce.number().min(0).max(1000000),
})

const quickPurchaseBody = z.object({
  vendorName: z.string().trim().max(160).optional().default(''),
  invoiceNumber: z.string().trim().max(60).optional().default(''),
  receiptImageData: z.string().max(500_000).refine((value) => !value || /^data:image\/(jpeg|png|webp);base64,/.test(value), 'Comprovante de imagem invalido.').optional().default(''),
  paymentMethod: z.enum(['cash', 'pix', 'credit', 'debit', 'transfer', 'later']),
  dueDate: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(500).optional().default(''),
  items: z.array(quickItemBody).min(1).max(100),
}).superRefine((body, context) => {
  if (body.paymentMethod === 'later' && !body.dueDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'Informe quando a compra sera paga.' })
})

router.post('/quick', validate({ body: quickPurchaseBody }), asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req); const auth = requireManage(req); const body = req.body as z.infer<typeof quickPurchaseBody>
  if (body.paymentMethod !== 'later' && !hasPermission(auth.role, auth.permissions, 'payables:manage')) {
    throw forbidden('Voce precisa da permissao financeira para registrar uma compra ja paga.')
  }
  const ingredientIds = [...new Set(body.items.map((item) => item.ingredientId))]
  if (ingredientIds.length !== body.items.length) throw badRequest('Cada insumo deve aparecer apenas uma vez na compra.')
  const [ingredients, count] = await Promise.all([
    prisma.ingredient.findMany({ where: { id: { in: ingredientIds }, tenantId, active: true } }),
    prisma.purchaseOrder.count({ where: { tenantId } }),
  ])
  if (ingredients.length !== ingredientIds.length) throw badRequest('Um ou mais insumos nao existem nesta loja.')
  const byId = new Map(ingredients.map((item) => [item.id, item]))
  const total = body.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const vendorName = body.vendorName || 'Compra avulsa'

  let cashRegisterId: string | null = null
  if (body.paymentMethod === 'cash') {
    if (!hasPermission(auth.role, auth.permissions, 'cash:close')) {
      throw forbidden('Voce precisa da permissao de saida do caixa para pagar esta compra em dinheiro.')
    }
    const register = await findOpenRegister(prisma, tenantId)
    if (!register) throw conflict('Abra o caixa antes de registrar uma compra paga em dinheiro.', 'CASH_CLOSED')
    const summary = await buildCashSummary(prisma, register.id)
    if (total > summary.expectedCash) throw badRequest(`Ha apenas R$ ${summary.expectedCash.toFixed(2)} em dinheiro no caixa.`)
    cashRegisterId = register.id
  }

  const now = new Date()
  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.create({ data: {
      tenantId, createdById: auth.userId, receivedById: auth.userId,
      orderNumber: `CQ-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`,
      status: 'received', purchaseMode: 'quick', quickVendorName: body.vendorName || null,
      paymentMethod: body.paymentMethod, hasReceiptImage: Boolean(body.receiptImageData),
      receiptImageData: body.receiptImageData || null, totalAmount: dec(total), notes: body.notes || null, receivedAt: now,
      items: { create: body.items.map((item) => ({ ingredientId: item.ingredientId, orderedQuantity: dec(item.quantity),
        receivedQuantity: dec(item.quantity), purchaseUnit: item.purchaseUnit, conversionFactor: dec(item.conversionFactor),
        unitPrice: dec(item.unitPrice), subtotal: dec(item.quantity * item.unitPrice) })) },
    }, include: { items: true } })
    const receipt = await tx.purchaseReceipt.create({ data: {
      tenantId, purchaseOrderId: order.id, receivedById: auth.userId, receiptNumber: 'REC-001',
      invoiceNumber: body.invoiceNumber || null, notes: body.notes || null, totalAmount: dec(total),
      items: { create: order.items.map((item) => ({ purchaseOrderItemId: item.id, receivedQuantity: item.orderedQuantity,
        stockQuantity: dec(Number(item.orderedQuantity) * Number(item.conversionFactor)), unitPrice: item.unitPrice, subtotal: item.subtotal })) },
    } })
    for (const input of body.items) {
      const ingredient = byId.get(input.ingredientId)!
      const stockAdded = input.quantity * input.conversionFactor; const before = Number(ingredient.stock); const after = before + stockAdded
      const costPerStockUnit = input.unitPrice / input.conversionFactor
      const newAverage = after > 0 ? ((before * Number(ingredient.price)) + (stockAdded * costPerStockUnit)) / after : costPerStockUnit
      await tx.ingredient.update({ where: { id: input.ingredientId }, data: { stock: dec(after), price: dec(newAverage) } })
      await tx.stockMovement.create({ data: { tenantId, ingredientId: input.ingredientId, actorId: auth.userId, type: 'purchase', delta: dec(stockAdded),
        balanceBefore: dec(before), balanceAfter: dec(after), reason: `Compra rapida ${order.orderNumber}`, sourceType: 'purchase_receipt', sourceId: receipt.id } })
    }
    const paid = body.paymentMethod !== 'later'
    const payable = await tx.accountPayable.create({ data: {
      tenantId, purchaseOrderId: order.id, supplierName: vendorName, description: `Compra rapida ${order.orderNumber}`,
      amount: moneyDec(total), amountPaid: paid ? moneyDec(total) : moneyDec(0), dueDate: paid ? now : body.dueDate!,
      paidAt: paid ? now : null, status: paid ? 'paid' : 'pending', invoiceNumber: body.invoiceNumber || null, notes: body.notes || null,
    } })
    if (cashRegisterId) await tx.cashEntry.create({ data: { cashRegisterId, type: 'expense', amount: moneyDec(total),
      description: `${vendorName} - compra rapida`, paymentMethod: 'cash', referenceType: 'purchase_order', referenceId: order.id, createdById: auth.userId } })
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, omit: orderOmit, include: orderInclude })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  emitToTenant(tenantId, 'purchase:updated', serialize(created))
  if (cashRegisterId) emitToTenant(tenantId, 'cash:entry', serialize({ kind: 'quick_purchase', orderId: created.id }))
  return createdResponse(res, created)
}))

router.get('/orders/:id/receipt-image', validate({ params: idParams }), asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req); const { id } = req.params as { id: string }
  const order = await prisma.purchaseOrder.findFirst({ where: { id, tenantId }, select: { receiptImageData: true } })
  if (!order) throw notFound('Compra nao encontrada.')
  if (!order.receiptImageData) throw notFound('Esta compra nao possui comprovante anexado.')
  return ok(res, { imageData: order.receiptImageData })
}))

router.patch('/orders/:id/status', validate({ params: idParams, body: z.object({ action: z.enum(['submit', 'approve', 'mark_ordered', 'cancel']) }) }), asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req); const auth = requireManage(req); const { id } = req.params as { id: string }
  const { action } = req.body as { action: 'submit' | 'approve' | 'mark_ordered' | 'cancel' }
  const order = await prisma.purchaseOrder.findFirst({ where: { id, tenantId } }); if (!order) throw notFound('Pedido de compra nao encontrado.')
  const rules = { submit: { from: ['draft'], to: 'pending_approval' }, approve: { from: ['pending_approval'], to: 'approved' }, mark_ordered: { from: ['approved'], to: 'ordered' }, cancel: { from: ['draft', 'pending_approval', 'approved', 'ordered'], to: 'cancelled' } } as const
  const rule = rules[action]; if (!(rule.from as readonly string[]).includes(order.status)) throw conflict('Esta acao nao e permitida no estado atual.', 'INVALID_PURCHASE_TRANSITION')
  const now = new Date(); const updated = await prisma.purchaseOrder.update({ where: { id }, data: { status: rule.to,
    ...(action === 'submit' ? { submittedAt: now } : {}), ...(action === 'approve' ? { approvedAt: now, approvedById: auth.userId } : {}),
    ...(action === 'mark_ordered' ? { orderedAt: now } : {}) }, omit: orderOmit, include: orderInclude })
  emitToTenant(tenantId, 'purchase:updated', serialize(updated)); return ok(res, updated)
}))

const receiptBody = z.object({
  invoiceNumber: z.string().trim().max(60).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
  items: z.array(z.object({
    itemId: z.string().min(1),
    quantity: z.coerce.number().positive().max(1000000),
  })).min(1).max(100),
})

router.patch('/orders/:id/receive', validate({ params: idParams, body: receiptBody }), asyncHandler(async (req, res) => {
  const tenantId = tenantOf(req); const auth = requireManage(req); const { id } = req.params as { id: string }
  const body = req.body as z.infer<typeof receiptBody>
  if (new Set(body.items.map((item) => item.itemId)).size !== body.items.length) throw badRequest('Cada item deve aparecer apenas uma vez no recebimento.')
  const now = new Date()
  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findFirst({ where: { id, tenantId }, include: { supplier: true, items: { include: { ingredient: true } }, _count: { select: { receipts: true } } } })
    if (!order) throw notFound('Pedido de compra nao encontrado.')
    if (!['approved', 'ordered', 'partially_received'].includes(order.status)) throw conflict('A compra precisa estar aprovada e possuir saldo pendente.', 'PURCHASE_NOT_RECEIVABLE')
    const byId = new Map(order.items.map((item) => [item.id, item]))
    const received = body.items.map((entry) => {
      const item = byId.get(entry.itemId)
      if (!item) throw badRequest('Um ou mais itens nao pertencem a este pedido.')
      const remaining = Number(item.orderedQuantity) - Number(item.receivedQuantity)
      if (entry.quantity > remaining + 0.00001) throw badRequest(`A quantidade de ${item.ingredient.name} supera o saldo pendente de ${remaining} ${item.purchaseUnit}.`)
      return { item, quantity: entry.quantity }
    })
    const receiptTotal = received.reduce((sum, entry) => sum + entry.quantity * Number(entry.item.unitPrice), 0)
    const receiptNumber = `REC-${String(order._count.receipts + 1).padStart(3, '0')}`
    const receipt = await tx.purchaseReceipt.create({ data: {
      tenantId, purchaseOrderId: order.id, receivedById: auth.userId, receiptNumber,
      invoiceNumber: body.invoiceNumber || null, notes: body.notes || null, totalAmount: dec(receiptTotal),
      items: { create: received.map(({ item, quantity }) => ({ purchaseOrderItemId: item.id,
        receivedQuantity: dec(quantity), stockQuantity: dec(quantity * Number(item.conversionFactor)),
        unitPrice: item.unitPrice, subtotal: dec(quantity * Number(item.unitPrice)) })) },
    } })
    for (const { item, quantity } of received) {
      const stockAdded = quantity * Number(item.conversionFactor); const before = Number(item.ingredient.stock); const after = before + stockAdded
      const costPerStockUnit = Number(item.unitPrice) / Number(item.conversionFactor)
      const newAverage = after > 0 ? ((before * Number(item.ingredient.price)) + (stockAdded * costPerStockUnit)) / after : costPerStockUnit
      await tx.ingredient.update({ where: { id: item.ingredientId }, data: { stock: dec(after), price: dec(newAverage) } })
      await tx.stockMovement.create({ data: { tenantId, ingredientId: item.ingredientId, actorId: auth.userId, type: 'purchase', delta: dec(stockAdded), balanceBefore: dec(before), balanceAfter: dec(after), reason: `Recebimento ${receiptNumber} · ${order.orderNumber}`, sourceType: 'purchase_receipt', sourceId: receipt.id } })
      await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQuantity: { increment: dec(quantity) } } })
    }
    const fullyReceived = order.items.every((item) => {
      const current = received.find((entry) => entry.item.id === item.id)?.quantity ?? 0
      return Number(item.receivedQuantity) + current >= Number(item.orderedQuantity) - 0.00001
    })
    if (!order.supplier) throw conflict('Pedido formal sem fornecedor vinculado.', 'PURCHASE_SUPPLIER_MISSING')
    const dueDate = new Date(now); dueDate.setDate(dueDate.getDate() + order.supplier.paymentTermDays)
    await tx.accountPayable.upsert({ where: { purchaseOrderId: order.id }, create: {
      tenantId, purchaseOrderId: order.id, supplierName: order.supplier.name, supplierDoc: order.supplier.document,
      description: `Compra ${order.orderNumber}`, amount: dec(receiptTotal), dueDate, status: 'pending',
      invoiceNumber: body.invoiceNumber || null, notes: order.notes,
    }, update: { amount: { increment: dec(receiptTotal) }, ...(body.invoiceNumber ? { invoiceNumber: body.invoiceNumber } : {}) } })
    await tx.purchaseOrder.update({ where: { id }, data: { status: fullyReceived ? 'received' : 'partially_received',
      receivedAt: fullyReceived ? now : null, receivedById: fullyReceived ? auth.userId : null } })
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, omit: orderOmit, include: orderInclude })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  emitToTenant(tenantId, 'purchase:updated', serialize(updated)); return ok(res, updated)
}))

export default router
