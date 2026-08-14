import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const baseUrl = process.env.TEST_API_URL || 'http://127.0.0.1:3001'
async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const payload = await response.json()
  if (!response.ok || !payload.success) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(payload)}`)
  return payload.data
}
function assert(condition, message) { if (!condition) throw new Error(message) }

let lotId = ''
let inventoryId = ''
let ingredientSnapshot
try {
  const session = await request('/api/auth/login', { method: 'POST', body: { email: 'admin@local', password: 'admin123' } })
  const [ingredient] = await request('/api/ingredients', { token: session.token })
  assert(ingredient, 'E necessario um insumo para o teste.')
  ingredientSnapshot = { id: ingredient.id, stock: ingredient.stock, price: ingredient.price }
  const lot = await request('/api/ingredients/lots', { token: session.token, method: 'POST', body: { ingredientId: ingredient.id, code: `TEST-${Date.now()}`, quantity: 2, expiresAt: '2026-12-31', unitCost: Number(ingredient.price) } })
  lotId = lot.id
  const lots = await request('/api/ingredients/lots', { token: session.token })
  assert(lots.some(item => item.id === lotId), 'O lote nao apareceu na listagem.')
  const afterLot = await prisma.ingredient.findUnique({ where: { id: ingredient.id } })
  assert(Number(afterLot.stock) === Number(ingredient.stock) + 2, 'O lote nao atualizou o saldo.')

  const inventory = await request('/api/ingredients/inventories', { token: session.token, method: 'POST', body: { notes: 'Teste automatico', items: [{ ingredientId: ingredient.id, countedQty: Number(afterLot.stock) - 0.5 }] } })
  inventoryId = inventory.id
  assert(inventory.differenceCount === 1, 'O inventario nao registrou a divergencia.')
  const afterInventory = await prisma.ingredient.findUnique({ where: { id: ingredient.id } })
  assert(Number(afterInventory.stock) === Number(afterLot.stock) - 0.5, 'O inventario nao ajustou o saldo contado.')
  console.log('OK: lote atualizou saldo e inventario ajustou divergencia com auditoria.')
} finally {
  if (inventoryId) await prisma.inventoryCount.delete({ where: { id: inventoryId } }).catch(() => {})
  if (lotId) {
    await prisma.stockMovement.deleteMany({ where: { lotId } })
    await prisma.stockLot.delete({ where: { id: lotId } }).catch(() => {})
  }
  if (ingredientSnapshot) {
    await prisma.stockMovement.deleteMany({ where: { sourceType: 'inventory', sourceId: inventoryId } })
    await prisma.ingredient.update({ where: { id: ingredientSnapshot.id }, data: { stock: ingredientSnapshot.stock, price: ingredientSnapshot.price } })
  }
  await prisma.$disconnect()
}
