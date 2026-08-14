import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const API = process.env.API_URL ?? 'http://localhost:3001'
const email = `entregador.teste.${Date.now()}@example.com`
let ownerToken = ''
let driverToken = ''
let tenantId = ''
let membershipId = ''
let userId = ''
let orderId = ''
let customerId = ''

async function request(path, options = {}, token = ownerToken) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  const json = await response.json()
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(json)}`)
  return json.data ?? json
}

try {
  const owner = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@local', password: 'admin123' }) }, '')
  ownerToken = owner.token; tenantId = owner.tenant.id
  const employee = await request('/api/users', { method: 'POST', body: JSON.stringify({ firstName: 'Rota', lastName: 'Teste', email, password: 'rota123', phone: '11999990000', preset: 'delivery', permissions: ['delivery:drive'], vehicleType: 'moto' }) })
  membershipId = employee.membershipId; userId = employee.id
  const customer = await prisma.customer.create({ data: { tenantId, name: 'Cliente da rota', phone: '11911112222', address: 'Praça da Sé, São Paulo - SP' } })
  customerId = customer.id
  const order = await prisma.order.create({ data: { tenantId, customerId, orderNumber: `ROTA-${Date.now()}`, status: 'ready', orderType: 'delivery', subtotal: 20, totalAmount: 20, deliveryAddress: 'Praça da Sé, São Paulo - SP', publicToken: 'a'.repeat(24) + Date.now().toString(16).padStart(24, '0').slice(-24), delivery: { create: { tenantId, status: 'awaiting_assignment', destinationLatitude: -23.55052, destinationLongitude: -46.633308 } } }, include: { delivery: true } })
  orderId = order.id
  const qr = await request(`/api/deliveries/${order.delivery.id}/pickup-code`)
  const driver = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'rota123' }) }, '')
  driverToken = driver.token
  await request('/api/driver/scan', { method: 'POST', body: JSON.stringify({ code: qr.payload }) }, driverToken)
  const queue = await request('/api/driver/queue', {}, driverToken)
  if (queue.deliveries.length !== 1) throw new Error('O QR nao entrou na fila do entregador.')
  const position = { latitude: -23.561684, longitude: -46.655981, accuracy: 10 }
  const plan = await request('/api/driver/route/plan', { method: 'POST', body: JSON.stringify(position) }, driverToken)
  if (!plan.route?.geometry?.length || !plan.deliveries?.[0]?.estimatedArrivalAt) throw new Error('A rota ou o ETA nao foram calculados.')
  await request('/api/driver/route/start', { method: 'POST', body: JSON.stringify(position) }, driverToken)
  await request(`/api/driver/${order.delivery.id}/complete`, { method: 'PATCH', body: '{}' }, driverToken)
  const finished = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { delivery: true } })
  if (finished.status !== 'delivered' || finished.delivery?.status !== 'delivered') throw new Error('A entrega nao foi concluida.')
  console.log('OK: login do entregador, QR, fila, rota real, ETA e conclusao.')
} finally {
  if (orderId) await prisma.order.delete({ where: { id: orderId } }).catch(() => {})
  if (customerId) await prisma.customer.delete({ where: { id: customerId } }).catch(() => {})
  if (membershipId) await prisma.membership.delete({ where: { id: membershipId } }).catch(() => {})
  if (userId) { await prisma.fleet.deleteMany({ where: { driverUserId: userId } }).catch(() => {}); await prisma.user.delete({ where: { id: userId } }).catch(() => {}) }
  await prisma.$disconnect()
}
