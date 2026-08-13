/**
 * Cardapio publico — sem login.
 *
 * Todas as rotas aqui sao escopadas pelo `slug` da loja na URL, nunca por
 * token. Isso significa que precisamos ser explicitos sobre o que expomos:
 * `costPrice`, `laborCost` e a ficha tecnica NUNCA saem daqui, senao
 * qualquer cliente veria a margem de lucro do restaurante.
 */
import { Router, type Request, type Response } from 'express'
import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, ok, notFound, badRequest, conflict, createdResponse, serialize } from '../lib/http.js'
import { validate, z, positiveInt } from '../lib/validate.js'
import { computeStoreStatus, resolveDeliveryFee } from '../services/storeService.js'
import { applyStockDeduction, type StockConsumption } from '../services/stockService.js'
import { publicCheckoutLimiter } from '../middleware/rateLimit.js'
import { emitToTenant } from '../lib/realtime.js'
import { env } from '../config/env.js'

const router = Router()
const dec = (value: number) => new Prisma.Decimal(value.toFixed(2))
const normalizePhone = (value: string) => value.replace(/\D/g, '').slice(-13)

async function nextOrderNumber(tx: Prisma.TransactionClient, tenantId: string) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const prefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const count = await tx.order.count({ where: { tenantId, createdAt: { gte: start } } })
  return `${prefix}-${String(count + 1).padStart(4, '0')}`
}

/** Busca a loja pelo slug, ou 404. */
async function findStoreBySlug(slug: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      active: true,
      isOpen: true,
      openingHours: true,
      deliveryFeeBase: true,
      deliveryZones: true,
      logoData: true,
      storefrontTheme: true,
    },
  })

  if (!tenant || !tenant.active) {
    throw notFound('Loja nao encontrada.')
  }
  return tenant
}

/**
 * GET /api/public/:slug/menu
 * Cardapio completo agrupado por categoria.
 */
router.get(
  '/:slug/menu',
  asyncHandler(async (req: Request, res: Response) => {
    const store = await findStoreBySlug(String(req.params.slug ?? ''))

    const [categories, uncategorized] = await Promise.all([
      prisma.menuCategory.findMany({
        where: { tenantId: store.id, active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          imageUrl: true,
          products: {
            where: { active: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            // Selecao explicita: sem custo, sem margem, sem ficha tecnica.
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              imageUrl: true,
              featured: true,
              productType: true,
              comboOptions: true,
              addons: {
                where: { active: true },
                orderBy: [{ groupName: 'asc' }, { sortOrder: 'asc' }],
                select: {
                  id: true,
                  name: true,
                  price: true,
                  groupName: true,
                  required: true,
                  maxQuantity: true,
                },
              },
            },
          },
        },
      }),
      // Produtos ativos que ainda nao foram associados a uma categoria.
      prisma.product.findMany({
        where: { tenantId: store.id, active: true, menuCategoryId: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          imageUrl: true,
          featured: true,
          productType: true,
          comboOptions: true,
          addons: {
            where: { active: true },
            orderBy: [{ groupName: 'asc' }, { sortOrder: 'asc' }],
            select: {
              id: true,
              name: true,
              price: true,
              groupName: true,
              required: true,
              maxQuantity: true,
            },
          },
        },
      }),
    ])

    const status = computeStoreStatus(store.isOpen, store.openingHours)

    const groups = categories
      .filter((category) => category.products.length > 0)
      .map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        imageUrl: category.imageUrl,
        products: category.products,
      }))

    if (uncategorized.length > 0) {
      groups.push({
        id: 'sem-categoria',
        name: 'Outros',
        slug: 'outros',
        description: null,
        imageUrl: null,
        products: uncategorized,
      })
    }

    return ok(res, {
      store: {
        name: store.name,
        slug: store.slug,
        phone: store.phone,
        address: store.address,
        city: store.city,
        state: store.state,
        logoData: store.logoData,
      },
      theme: store.storefrontTheme,
      status,
      deliveryFeeBase: store.deliveryFeeBase,
      deliveryZones: store.deliveryZones ?? [],
      categories: groups,
    })
  }),
)

/** GET /api/public/:slug/status — usado pelo cardapio para atualizar o aviso. */
router.get(
  '/:slug/status',
  asyncHandler(async (req: Request, res: Response) => {
    const store = await findStoreBySlug(String(req.params.slug ?? ''))
    return ok(res, computeStoreStatus(store.isOpen, store.openingHours))
  }),
)

/**
 * GET /api/public/:slug/delivery-fee?neighborhood=Centro
 * Permite o cliente ver a taxa antes de finalizar.
 */
router.get(
  '/:slug/delivery-fee',
  asyncHandler(async (req: Request, res: Response) => {
    const store = await findStoreBySlug(String(req.params.slug ?? ''))
    const neighborhood = req.query.neighborhood ? String(req.query.neighborhood) : null

    const result = resolveDeliveryFee(
      store.deliveryZones,
      Number(store.deliveryFeeBase),
      neighborhood,
    )

    return ok(res, result)
  }),
)

// ---------------------------------------------------------------------------
// POST /api/public/:slug/orders — checkout da loja digital
// ---------------------------------------------------------------------------

const publicAddonInput = z.object({
  addonId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(20).default(1),
})

const publicCheckoutSchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: positiveInt,
    observations: z.string().trim().max(300).nullish(),
    selectedProteinId: z.string().min(1).nullish(),
    addons: z.array(publicAddonInput).max(20).default([]),
  })).min(1, 'Seu carrinho esta vazio').max(60),
  customer: z.object({
    name: z.string().trim().min(2, 'Informe seu nome').max(100),
    phone: z.string().trim().min(8, 'Informe um telefone valido').max(24),
    address: z.string().trim().max(180).default(''),
    neighborhood: z.string().trim().max(100).default(''),
    city: z.string().trim().max(100).default(''),
    state: z.string().trim().max(2).default(''),
    zipCode: z.string().trim().max(12).default(''),
  }),
  orderType: z.enum(['delivery', 'balcao']).default('delivery'),
  paymentMethod: z.enum(['cash', 'pix', 'credit', 'debit']).default('pix'),
  changeFor: z.coerce.number().min(0).nullish(),
  observations: z.string().trim().max(500).nullish(),
})

/**
 * Reconhece o consumidor entre lojas pelo telefone, como nos apps de delivery.
 * A rota e POST para o telefone nao acabar em historico de URL/proxy.
 * Em producao, esta resposta deve ser liberada depois de OTP por WhatsApp/SMS.
 */
router.post(
  '/customers/lookup',
  publicCheckoutLimiter,
  validate({ body: z.object({ phone: z.string().trim().min(8).max(24) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const phone = normalizePhone(String(req.body.phone ?? ''))
    if (phone.length < 10) throw badRequest('Informe um telefone com DDD.')
    const profile = await prisma.consumerProfile.findUnique({
      where: { phone },
      select: {
        name: true,
        phone: true,
        address: true,
        neighborhood: true,
        city: true,
        state: true,
        zipCode: true,
      },
    })
    return ok(res, { found: Boolean(profile), profile })
  }),
)

router.post(
  '/:slug/orders',
  publicCheckoutLimiter,
  validate({ body: publicCheckoutSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const store = await findStoreBySlug(String(req.params.slug ?? ''))
    const body = req.body as z.infer<typeof publicCheckoutSchema>
    const normalizedPhone = normalizePhone(body.customer.phone)
    if (normalizedPhone.length < 10) throw badRequest('Informe um telefone com DDD.')
    const status = computeStoreStatus(store.isOpen, store.openingHours)
    if (!status.open) throw conflict(`A loja nao esta aceitando pedidos: ${status.reason}.`, 'STORE_CLOSED')

    if (body.orderType === 'delivery' && (!body.customer.address || !body.customer.neighborhood)) {
      throw badRequest('Informe o endereco e o bairro para entrega.')
    }

    const productIds = [...new Set(body.items.map((item) => item.productId))]
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, tenantId: store.id, active: true },
      include: { technicalSheet: true, addons: { where: { active: true } } },
    })
    if (products.length !== productIds.length) throw badRequest('Um produto do carrinho nao esta mais disponivel.')

    const productMap = new Map(products.map((product) => [product.id, product]))
    const consumptions: StockConsumption[] = []
    const orderItems: Prisma.OrderItemCreateWithoutOrderInput[] = []
    let subtotal = 0

    for (const item of body.items) {
      const product = productMap.get(item.productId)!
      const comboOptions = Array.isArray(product.comboOptions)
        ? product.comboOptions as Array<{ label?: string; ingredientId?: string; quantity?: number }>
        : []
      let selectedProteinName: string | null = null
      let selectedProteinId: string | null = null

      if (product.productType === 'combo' && comboOptions.length > 0) {
        const chosen = comboOptions.find((option) => option.ingredientId === item.selectedProteinId)
        if (!chosen?.ingredientId) throw badRequest(`Escolha uma opcao valida para "${product.name}".`)
        selectedProteinId = chosen.ingredientId
        selectedProteinName = chosen.label ?? 'Opcao escolhida'
        const sheetLine = product.technicalSheet.find((line) => line.isMainProtein && line.ingredientId === chosen.ingredientId)
        const quantity = Number(sheetLine?.quantity ?? chosen.quantity ?? 0)
        if (quantity > 0) consumptions.push({ ingredientId: chosen.ingredientId, quantity: quantity * item.quantity })
      }

      for (const line of product.technicalSheet) {
        if (!line.isMainProtein) consumptions.push({
          ingredientId: line.ingredientId,
          quantity: Number(line.quantity) * item.quantity,
        })
      }

      const addonMap = new Map(product.addons.map((addon) => [addon.id, addon]))
      const frozenAddons: Array<{ addonId: string; name: string; price: number; quantity: number }> = []
      let addonTotal = 0
      for (const selected of item.addons) {
        const addon = addonMap.get(selected.addonId)
        if (!addon || selected.quantity > addon.maxQuantity) {
          throw badRequest(`Adicional invalido para "${product.name}".`)
        }
        const price = Number(addon.price)
        addonTotal += price * selected.quantity * item.quantity
        frozenAddons.push({ addonId: addon.id, name: addon.name, price, quantity: selected.quantity })
        if (addon.ingredientId && addon.ingredientQty) consumptions.push({
          ingredientId: addon.ingredientId,
          quantity: Number(addon.ingredientQty) * selected.quantity * item.quantity,
        })
      }

      const requiredGroups = [...new Set(product.addons.filter((addon) => addon.required).map((addon) => addon.groupName))]
      for (const group of requiredGroups) {
        const validIds = product.addons.filter((addon) => addon.groupName === group).map((addon) => addon.id)
        if (!item.addons.some((addon) => validIds.includes(addon.addonId))) {
          throw badRequest(`"${product.name}": escolha uma opcao de "${group}".`)
        }
      }

      const unitPrice = Number(product.price)
      const lineSubtotal = unitPrice * item.quantity + addonTotal
      subtotal += lineSubtotal
      orderItems.push({
        product: { connect: { id: product.id } },
        quantity: item.quantity,
        unitPrice: dec(unitPrice),
        subtotal: dec(lineSubtotal),
        observations: item.observations ?? null,
        selectedProteinId,
        selectedProteinName,
        addons: frozenAddons.length ? frozenAddons as unknown as Prisma.InputJsonValue : undefined,
        addonsTotal: dec(addonTotal),
      })
    }

    const delivery = resolveDeliveryFee(
      store.deliveryZones,
      Number(store.deliveryFeeBase),
      body.orderType === 'delivery' ? body.customer.neighborhood : null,
    )
    const deliveryFee = body.orderType === 'delivery' ? delivery.fee : 0
    if (body.orderType === 'delivery' && delivery.zone && subtotal < delivery.zone.minOrder) {
      throw badRequest(`O pedido minimo para ${delivery.zone.name} e R$ ${delivery.zone.minOrder.toFixed(2)}.`)
    }

    const total = Math.round((subtotal + deliveryFee) * 100) / 100
    let changeAmount: number | null = null
    if (body.paymentMethod === 'cash' && body.changeFor != null) {
      if (body.changeFor < total) throw badRequest('O valor para troco e menor que o total do pedido.')
      changeAmount = Math.round((body.changeFor - total) * 100) / 100
    }

    const publicToken = randomBytes(24).toString('hex')
    const channel = await prisma.salesChannel.findFirst({
      where: { tenantId: store.id, active: true, slug: { in: ['loja-propria', 'whatsapp'] } },
      orderBy: { slug: 'asc' },
      select: { id: true },
    })

    const order = await prisma.$transaction(async (tx) => {
      await tx.consumerProfile.upsert({
        where: { phone: normalizedPhone },
        create: {
          phone: normalizedPhone,
          name: body.customer.name,
          address: body.customer.address || null,
          neighborhood: body.customer.neighborhood || null,
          city: body.customer.city || null,
          state: body.customer.state.toUpperCase() || null,
          zipCode: body.customer.zipCode || null,
        },
        update: {
          name: body.customer.name,
          address: body.customer.address || null,
          neighborhood: body.customer.neighborhood || null,
          city: body.customer.city || null,
          state: body.customer.state.toUpperCase() || null,
          zipCode: body.customer.zipCode || null,
        },
      })

      const existingCustomer = await tx.customer.findFirst({
        where: { tenantId: store.id, phone: normalizedPhone },
      })
      const customer = existingCustomer
        ? await tx.customer.update({
          where: { id: existingCustomer.id },
          data: {
            name: body.customer.name,
            address: body.customer.address || null,
            neighborhood: body.customer.neighborhood || null,
            city: body.customer.city || null,
            state: body.customer.state.toUpperCase() || null,
            zipCode: body.customer.zipCode || null,
          },
        })
        : await tx.customer.create({ data: {
          tenantId: store.id,
          name: body.customer.name,
          phone: normalizedPhone,
          address: body.customer.address || null,
          neighborhood: body.customer.neighborhood || null,
          city: body.customer.city || null,
          state: body.customer.state.toUpperCase() || null,
          zipCode: body.customer.zipCode || null,
        } })

      await applyStockDeduction(tx, store.id, consumptions, env.ALLOW_NEGATIVE_STOCK)

      const createdOrder = await tx.order.create({
        data: {
          orderNumber: await nextOrderNumber(tx, store.id),
          publicToken,
          status: 'pending',
          orderType: body.orderType,
          subtotal: dec(subtotal),
          deliveryFee: dec(deliveryFee),
          totalAmount: dec(total),
          paymentMethod: body.paymentMethod,
          paymentStatus: 'pending',
          changeFor: body.changeFor != null ? dec(body.changeFor) : null,
          changeAmount: changeAmount != null ? dec(changeAmount) : null,
          observations: body.observations ?? null,
          deliveryAddress: body.orderType === 'delivery'
            ? [body.customer.address, body.customer.neighborhood, body.customer.city, body.customer.state]
                .filter(Boolean).join(' · ')
            : null,
          tenantId: store.id,
          customerId: customer.id,
          salesChannelId: channel?.id ?? null,
          orderItems: { create: orderItems },
          payments: { create: {
            method: body.paymentMethod,
            amount: dec(total),
            changeFor: body.changeFor != null ? dec(body.changeFor) : null,
            changeAmount: changeAmount != null ? dec(changeAmount) : null,
          } },
          ...(body.orderType === 'delivery' && {
            delivery: { create: { tenantId: store.id, status: 'pending' } },
          }),
        },
        include: { orderItems: { include: { product: { select: { name: true } } } } },
      })

      await tx.orderEvent.create({
        data: {
          tenantId: store.id,
          orderId: createdOrder.id,
          type: 'created',
          toStatus: 'pending',
          note: 'loja-digital',
        },
      })
      await tx.customer.update({
        where: { id: customer.id },
        data: { ltv: { increment: total }, totalOrders: { increment: 1 }, lastOrderAt: new Date() },
      })

      return createdOrder
    })

    emitToTenant(store.id, 'order:created', serialize(order))
    return createdResponse(res, {
      orderNumber: order.orderNumber,
      publicToken,
      status: order.status,
      totalAmount: total,
      deliveryFee,
    })
  }),
)

/** GET /api/public/orders/:token — acompanhamento com credencial aleatoria. */
router.get(
  '/orders/:token',
  asyncHandler(async (req: Request, res: Response) => {
    const token = String(req.params.token ?? '').trim()
    if (!/^[a-f0-9]{48}$/.test(token)) throw notFound('Pedido nao encontrado.')

    const order = await prisma.order.findUnique({
      where: { publicToken: token },
      select: {
        orderNumber: true,
        status: true,
        orderType: true,
        subtotal: true,
        deliveryFee: true,
        totalAmount: true,
        paymentMethod: true,
        paymentStatus: true,
        deliveryAddress: true,
        createdAt: true,
        updatedAt: true,
        orderItems: {
          select: {
            quantity: true,
            unitPrice: true,
            subtotal: true,
            observations: true,
            selectedProteinName: true,
            addons: true,
            product: { select: { name: true, imageUrl: true } },
          },
        },
        tenant: { select: { name: true, phone: true, slug: true, logoData: true, storefrontTheme: true } },
      },
    })
    if (!order) throw notFound('Pedido nao encontrado.')
    return ok(res, serialize(order))
  }),
)

/**
 * GET /api/public/order/:code
 * Acompanhamento do pedido pelo codigo, sem login.
 */
router.get(
  '/order/:code',
  asyncHandler(async (req: Request, res: Response) => {
    const code = String(req.params.code ?? '').trim().toUpperCase()
    const token = String(req.query.token ?? '').trim()
    if (!/^[a-f0-9]{48}$/.test(token)) throw notFound('Pedido nao encontrado. Confira o link.')

    const order = await prisma.order.findFirst({
      where: { orderNumber: code, publicToken: token },
      select: {
        orderNumber: true,
        status: true,
        orderType: true,
        totalAmount: true,
        createdAt: true,
        // A relacao no schema chama-se `orderItems` (nao `items`), e o campo
        // de observacao do item e `observations` (nao `notes`).
        orderItems: {
          select: {
            quantity: true,
            unitPrice: true,
            observations: true,
            selectedProteinName: true,
            addons: true,
            product: { select: { name: true } },
          },
        },
        tenant: { select: { name: true, phone: true } },
      },
    })

    if (!order) throw notFound('Pedido nao encontrado. Confira o codigo.')

    return ok(res, order)
  }),
)

export default router
