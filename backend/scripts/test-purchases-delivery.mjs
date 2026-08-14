import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const baseUrl = process.env.TEST_API_URL || 'http://127.0.0.1:3001'

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json()
  if (!response.ok || !payload.success) {
    throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(payload)}`)
  }
  return payload.data
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

let purchaseOrderId
let supplierId
let deliveryOrderId
let ingredientSnapshot

try {
  const session = await request('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@local', password: 'admin123' },
  })
  const token = session.token
  const tenantId = session.tenant.id

  const dashboard = await request('/api/purchases/dashboard', { token })
  const [ingredient, secondIngredient] = dashboard.ingredients
  assert(ingredient && secondIngredient, 'A loja precisa de ao menos dois insumos para o teste de compras.')
  ingredientSnapshot = [ingredient, secondIngredient].map((item) => ({ id: item.id, stock: item.stock, price: item.price }))

  const supplier = await request('/api/purchases/suppliers', {
    token,
    method: 'POST',
    body: { name: `Fornecedor teste ${Date.now()}`, paymentTermDays: 7 },
  })
  supplierId = supplier.id

  let purchase = await request('/api/purchases/orders', {
    token,
    method: 'POST',
    body: {
      supplierId,
      submitForApproval: true,
      items: [ingredient, secondIngredient].map((item, index) => ({
        ingredientId: item.id, orderedQuantity: index === 0 ? 4 : 3, purchaseUnit: item.unit,
        conversionFactor: 1, unitPrice: Number(item.price) + 1,
      })),
    },
  })
  purchaseOrderId = purchase.id
  assert(purchase.status === 'pending_approval', 'A compra nao entrou em aprovacao.')

  purchase = await request(`/api/purchases/orders/${purchase.id}/status`, { token, method: 'PATCH', body: { action: 'approve' } })
  purchase = await request(`/api/purchases/orders/${purchase.id}/status`, { token, method: 'PATCH', body: { action: 'mark_ordered' } })
  purchase = await request(`/api/purchases/orders/${purchase.id}/receive`, { token, method: 'PATCH', body: {
    invoiceNumber: 'NF-TESTE-1', items: [
      { itemId: purchase.items[0].id, quantity: 2 },
      { itemId: purchase.items[1].id, quantity: 3 },
    ],
  } })
  assert(purchase.status === 'partially_received', 'A primeira entrada nao manteve o saldo parcial.')
  assert(purchase.receipts.length === 1, 'O primeiro recebimento nao foi auditado.')
  purchase = await request(`/api/purchases/orders/${purchase.id}/receive`, { token, method: 'PATCH', body: {
    invoiceNumber: 'NF-TESTE-2', items: [{ itemId: purchase.items[0].id, quantity: 2 }],
  } })
  assert(purchase.status === 'received', 'A segunda entrada nao encerrou a compra.')
  assert(purchase.receipts.length === 2, 'Os dois recebimentos nao foram preservados no historico.')
  assert(purchase.accountPayable?.status === 'pending', 'O recebimento nao gerou conta a pagar.')
  const receivedIngredient = await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })
  assert(Number(receivedIngredient.stock) === Number(ingredient.stock) + 4, 'Os recebimentos parciais nao atualizaram o estoque corretamente.')
  assert(Number(purchase.accountPayable.amount) === Number(purchase.totalAmount), 'A conta a pagar nao acumulou o valor das duas entradas.')

  const product = await prisma.product.findFirstOrThrow({ where: { tenantId, active: true } })
  const orderNumber = `TEST-${Date.now()}`
  const publicToken = randomBytes(24).toString('hex')
  const deliveryOrder = await prisma.order.create({
    data: {
      tenantId,
      createdById: session.user.id,
      orderNumber,
      status: 'ready',
      orderType: 'delivery',
      subtotal: product.price,
      totalAmount: product.price,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      deliveryAddress: 'Endereco de teste automatizado',
      publicToken,
      orderItems: { create: {
        productId: product.id,
        quantity: 1,
        unitPrice: product.price,
        subtotal: product.price,
        productionStatus: 'ready',
        readyAt: new Date(),
      } },
      delivery: { create: { tenantId, status: 'awaiting_assignment' } },
    },
    include: { delivery: true },
  })
  deliveryOrderId = deliveryOrder.id
  const deliveryId = deliveryOrder.delivery.id

  let delivery = await request(`/api/deliveries/${deliveryId}/assign`, { token, method: 'PATCH', body: { dispatchMode: 'manual' } })
  assert(delivery.status === 'assigned' && !delivery.courierId, 'O despacho manual exigiu um entregador.')
  const publicAssigned = await request(`/api/public/orders/${publicToken}`)
  assert(publicAssigned.delivery?.deliveryCode, 'O codigo nao apareceu ao cliente no despacho sem entregador.')
  assert(publicAssigned.delivery?.dispatchMode === 'manual', 'O modo de despacho manual nao chegou ao acompanhamento.')

  delivery = await request(`/api/deliveries/${deliveryId}/pickup`, { token, method: 'PATCH', body: {} })
  assert(delivery.status === 'in_transit' && delivery.order.status === 'dispatched', 'O pedido sem entregador nao avancou para entrega.')
  delivery = await request(`/api/deliveries/${deliveryId}/complete`, {
    token,
    method: 'PATCH',
    body: { deliveryCode: delivery.deliveryCode, recipientName: 'Cliente teste', proofNotes: 'Fluxo automatizado' },
  })
  assert(delivery.status === 'delivered' && delivery.order.status === 'delivered', 'O pedido sem entregador nao foi concluido.')

  console.log('OK: compra atualizou estoque e financeiro; entrega avancou e concluiu sem entregador.')
} finally {
  if (deliveryOrderId) await prisma.order.deleteMany({ where: { id: deliveryOrderId } })
  if (purchaseOrderId) {
    await prisma.$transaction([
      prisma.stockMovement.deleteMany({ where: { sourceType: 'purchase_receipt', sourceId: { in: (await prisma.purchaseReceipt.findMany({ where: { purchaseOrderId }, select: { id: true } })).map((item) => item.id) } } }),
      prisma.accountPayable.deleteMany({ where: { purchaseOrderId } }),
      prisma.purchaseOrder.deleteMany({ where: { id: purchaseOrderId } }),
    ])
  }
  if (supplierId) await prisma.supplier.deleteMany({ where: { id: supplierId } })
  if (ingredientSnapshot) await Promise.all(ingredientSnapshot.map((item) => prisma.ingredient.update({ where: { id: item.id }, data: { stock: item.stock, price: item.price } })))
  await prisma.$disconnect()
}
