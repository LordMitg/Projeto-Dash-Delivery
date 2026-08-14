import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const baseUrl = process.env.TEST_API_URL || 'http://127.0.0.1:3001'

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json()
  if (!response.ok || !payload.success) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(payload)}`)
  return payload.data
}

function assert(condition, message) { if (!condition) throw new Error(message) }

const purchaseIds = []
let ingredientSnapshots = []
try {
  const session = await request('/api/auth/login', { method: 'POST', body: { email: 'admin@local', password: 'admin123' } })
  const dashboard = await request('/api/purchases/dashboard', { token: session.token })
  const ingredients = dashboard.ingredients.slice(0, 2)
  assert(ingredients.length === 2, 'Sao necessarios dois insumos para o teste.')
  ingredientSnapshots = ingredients.map((item) => ({ id: item.id, stock: item.stock, price: item.price }))
  const supplierCountBefore = await prisma.supplier.count({ where: { tenantId: session.tenant.id } })

  const paid = await request('/api/purchases/quick', { token: session.token, method: 'POST', body: {
    vendorName: '', paymentMethod: 'pix', invoiceNumber: 'CUPOM-TESTE',
    receiptImageData: 'data:image/png;base64,aGVsbG8=',
    items: [{ ingredientId: ingredients[0].id, quantity: 2, purchaseUnit: ingredients[0].unit, conversionFactor: 1, unitPrice: Number(ingredients[0].price) + 0.5 }],
  } })
  purchaseIds.push(paid.id)
  assert(paid.purchaseMode === 'quick' && paid.supplier === null, 'A compra rapida criou ou exigiu fornecedor.')
  assert(paid.status === 'received' && paid.receipts.length === 1, 'A entrada imediata nao foi concluida.')
  assert(paid.accountPayable.status === 'paid' && Number(paid.accountPayable.amountPaid) === Number(paid.totalAmount), 'O Pix nao foi registrado como quitado.')
  assert(!Object.hasOwn(paid, 'receiptImageData') && paid.hasReceiptImage, 'A listagem expos a imagem ou perdeu o indicador do anexo.')
  const image = await request(`/api/purchases/orders/${paid.id}/receipt-image`, { token: session.token })
  assert(image.imageData.startsWith('data:image/png;base64,'), 'O comprovante nao pode ser recuperado.')

  const due = new Date(); due.setDate(due.getDate() + 5)
  const later = await request('/api/purchases/quick', { token: session.token, method: 'POST', body: {
    vendorName: 'Mercado de teste', paymentMethod: 'later', dueDate: due.toISOString(),
    items: [{ ingredientId: ingredients[1].id, quantity: 3, purchaseUnit: ingredients[1].unit, conversionFactor: 1, unitPrice: Number(ingredients[1].price) + 0.5 }],
  } })
  purchaseIds.push(later.id)
  assert(later.accountPayable.status === 'pending' && Number(later.accountPayable.amountPaid) === 0, 'Pagar depois nao criou uma conta pendente.')
  assert(await prisma.supplier.count({ where: { tenantId: session.tenant.id } }) === supplierCountBefore, 'A compra avulsa criou fornecedor escondido.')
  console.log('OK: compra rapida sem fornecedor atualizou estoque, Pix ficou quitado e pagar depois ficou pendente.')
} finally {
  if (purchaseIds.length) {
    const receiptIds = (await prisma.purchaseReceipt.findMany({ where: { purchaseOrderId: { in: purchaseIds } }, select: { id: true } })).map(item => item.id)
    await prisma.stockMovement.deleteMany({ where: { sourceType: 'purchase_receipt', sourceId: { in: receiptIds } } })
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: purchaseIds } } })
  }
  if (ingredientSnapshots.length) await Promise.all(ingredientSnapshots.map(item => prisma.ingredient.update({ where: { id: item.id }, data: { stock: item.stock, price: item.price } })))
  await prisma.$disconnect()
}
