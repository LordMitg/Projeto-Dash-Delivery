import { randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const ORDER_NUMBER = 'DEMO-ROTA-001'
const CUSTOMER_PHONE = '11911112222'

try {
  const owner = await prisma.user.findUnique({
    where: { email: 'admin@local' },
    include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
  })
  const tenantId = owner?.memberships[0]?.tenantId
  if (!tenantId) throw new Error('Tenant do administrador local não encontrado.')

  const product = await prisma.product.findFirst({
    where: { tenantId, active: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!product) throw new Error('Cadastre ao menos um produto antes de criar o pedido de demonstração.')

  let customer = await prisma.customer.findFirst({ where: { tenantId, phone: CUSTOMER_PHONE } })
  customer ??= await prisma.customer.create({
    data: {
      tenantId,
      name: 'Cliente Demo Rota',
      phone: CUSTOMER_PHONE,
      address: 'Praça da Sé, São Paulo - SP',
      neighborhood: 'Sé',
      city: 'São Paulo',
      state: 'SP',
    },
  })

  const existing = await prisma.order.findFirst({ where: { tenantId, orderNumber: ORDER_NUMBER } })
  const publicToken = randomBytes(24).toString('hex')
  const itemValue = product.price

  const order = existing
    ? await prisma.order.update({
        where: { id: existing.id },
        data: {
          customerId: customer.id,
          status: 'ready',
          orderType: 'delivery',
          subtotal: itemValue,
          deliveryFee: 0,
          discount: 0,
          totalAmount: itemValue,
          paymentStatus: 'paid',
          paymentMethod: 'pix',
          observations: 'Pedido de demonstração do fluxo com QR Code.',
          deliveryAddress: 'Praça da Sé, São Paulo - SP',
          deliveredAt: null,
          publicToken,
          delivery: {
            upsert: {
              create: {
                tenantId,
                status: 'awaiting_assignment',
                destinationLatitude: -23.55052,
                destinationLongitude: -46.633308,
              },
              update: {
                status: 'awaiting_assignment',
                actualTime: null,
                assignedAt: null,
                pickedUpAt: null,
                pickupToken: null,
                pickupTokenExpiresAt: null,
                driverUserId: null,
                routeBatchId: null,
                routePosition: null,
                routeStartedAt: null,
                estimatedArrivalAt: null,
                assignedToId: null,
                courierId: null,
                destinationLatitude: -23.55052,
                destinationLongitude: -46.633308,
              },
            },
          },
        },
        include: { delivery: true },
      })
    : await prisma.order.create({
        data: {
          tenantId,
          customerId: customer.id,
          orderNumber: ORDER_NUMBER,
          status: 'ready',
          orderType: 'delivery',
          subtotal: itemValue,
          deliveryFee: 0,
          totalAmount: itemValue,
          paymentStatus: 'paid',
          paymentMethod: 'pix',
          observations: 'Pedido de demonstração do fluxo com QR Code.',
          deliveryAddress: 'Praça da Sé, São Paulo - SP',
          publicToken,
          orderItems: {
            create: {
              productId: product.id,
              quantity: 1,
              unitPrice: product.price,
              subtotal: product.price,
              productionStatus: 'ready',
              preparationStation: product.preparationStation,
              preparationTimeMinutes: product.preparationTimeMinutes,
              readyAt: new Date(),
            },
          },
          delivery: {
            create: {
              tenantId,
              status: 'awaiting_assignment',
              destinationLatitude: -23.55052,
              destinationLongitude: -46.633308,
            },
          },
        },
        include: { delivery: true },
      })

  console.log(`OK: pedido ${order.orderNumber} pronto para testar o QR na tela de Entregas.`)
} finally {
  await prisma.$disconnect()
}
