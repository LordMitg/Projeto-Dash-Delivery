/**
 * Cardapio publico — sem login.
 *
 * Todas as rotas aqui sao escopadas pelo `slug` da loja na URL, nunca por
 * token. Isso significa que precisamos ser explicitos sobre o que expomos:
 * `costPrice`, `laborCost` e a ficha tecnica NUNCA saem daqui, senao
 * qualquer cliente veria a margem de lucro do restaurante.
 */
import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, ok, notFound } from '../lib/http.js'
import { computeStoreStatus, resolveDeliveryFee } from '../services/storeService.js'

const router = Router()

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
      },
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

/**
 * GET /api/public/order/:code
 * Acompanhamento do pedido pelo codigo, sem login.
 */
router.get(
  '/order/:code',
  asyncHandler(async (req: Request, res: Response) => {
    const code = String(req.params.code ?? '').trim().toUpperCase()

    const order = await prisma.order.findFirst({
      where: { orderNumber: code },
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
