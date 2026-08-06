/**
 * Categorias do cardapio e adicionais dos produtos.
 *
 * Rotas que nao existiam antes: o schema tinha produtos, mas nao havia como
 * agrupa-los em categorias nem cadastrar opcionais pagos.
 */
import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, ok, created, noContent } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { requireStockAccess } from '../middleware/auth.js'
import { slugify } from '../lib/slug.js'
import { z } from 'zod'

const router = Router()

// ============================================================
// CATEGORIAS
// ============================================================

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Nome da categoria e obrigatorio'),
  description: z.string().trim().optional(),
  imageUrl: z.string().trim().optional(),
  sortOrder: z.coerce.number().int().default(0),
  active: z.coerce.boolean().default(true),
})

/** GET /api/menu/categories — lista categorias com contagem de produtos. */
router.get(
  '/categories',
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!

    const categories = await prisma.menuCategory.findMany({
      where: { tenantId },
      include: { _count: { select: { products: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })

    return ok(res, categories)
  }),
)

/** POST /api/menu/categories */
router.post(
  '/categories',
  requireStockAccess,
  validate({ body: categorySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const body = req.body as z.infer<typeof categorySchema>

    const slug = slugify(body.name)

    const existing = await prisma.menuCategory.findFirst({
      where: { slug, tenantId },
    })
    if (existing) {
      return res.status(409).json({
        success: false,
        error: `Ja existe uma categoria chamada "${existing.name}".`,
      })
    }

    const category = await prisma.menuCategory.create({
      data: {
        name: body.name,
        slug,
        description: body.description || null,
        imageUrl: body.imageUrl || null,
        sortOrder: body.sortOrder,
        active: body.active,
        tenantId,
      },
    })

    return created(res, category)
  }),
)

/** PUT /api/menu/categories/:id */
router.put(
  '/categories/:id',
  requireStockAccess,
  validate({ body: categorySchema.partial() }),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const id = String(req.params.id ?? '')
    const body = req.body as Partial<z.infer<typeof categorySchema>>

    const category = await prisma.menuCategory.findFirst({ where: { id, tenantId } })
    if (!category) {
      return res.status(404).json({ success: false, error: 'Categoria nao encontrada.' })
    }

    const updated = await prisma.menuCategory.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name, slug: slugify(body.name) }),
        ...(body.description !== undefined && { description: body.description || null }),
        ...(body.imageUrl !== undefined && { imageUrl: body.imageUrl || null }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
        ...(body.active !== undefined && { active: body.active }),
      },
    })

    return ok(res, updated)
  }),
)

/**
 * DELETE /api/menu/categories/:id
 *
 * Nao apaga os produtos: a relacao usa `onDelete: SetNull`, entao os produtos
 * apenas ficam sem categoria.
 */
router.delete(
  '/categories/:id',
  requireStockAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const id = String(req.params.id ?? '')

    const category = await prisma.menuCategory.findFirst({ where: { id, tenantId } })
    if (!category) {
      return res.status(404).json({ success: false, error: 'Categoria nao encontrada.' })
    }

    await prisma.menuCategory.delete({ where: { id } })
    return noContent(res)
  }),
)

// ============================================================
// ADICIONAIS
// ============================================================

const addonSchema = z.object({
  productId: z.string().min(1, 'productId e obrigatorio'),
  name: z.string().trim().min(1, 'Nome do adicional e obrigatorio'),
  price: z.coerce.number().min(0).default(0),
  groupName: z.string().trim().default('Adicionais'),
  required: z.coerce.boolean().default(false),
  maxQuantity: z.coerce.number().int().min(1).default(1),
  ingredientId: z.string().optional().nullable(),
  ingredientQty: z.coerce.number().min(0).optional().nullable(),
  sortOrder: z.coerce.number().int().default(0),
  active: z.coerce.boolean().default(true),
})

/** GET /api/menu/addons?productId=... */
router.get(
  '/addons',
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const { productId } = req.query

    const addons = await prisma.productAddon.findMany({
      where: {
        tenantId,
        ...(productId ? { productId: String(productId) } : {}),
      },
      include: {
        product: { select: { id: true, name: true } },
      },
      orderBy: [{ groupName: 'asc' }, { sortOrder: 'asc' }],
    })

    return ok(res, addons)
  }),
)

/** POST /api/menu/addons */
router.post(
  '/addons',
  requireStockAccess,
  validate({ body: addonSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const body = req.body as z.infer<typeof addonSchema>

    const product = await prisma.product.findFirst({
      where: { id: body.productId, tenantId },
    })
    if (!product) {
      return res.status(404).json({ success: false, error: 'Produto nao encontrado.' })
    }

    // Se o adicional consome insumo, o insumo precisa existir na loja.
    if (body.ingredientId) {
      const ingredient = await prisma.ingredient.findFirst({
        where: { id: body.ingredientId, tenantId },
      })
      if (!ingredient) {
        return res.status(404).json({ success: false, error: 'Insumo nao encontrado.' })
      }
      if (!body.ingredientQty || body.ingredientQty <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Informe a quantidade de insumo consumida por unidade do adicional.',
        })
      }
    }

    const addon = await prisma.productAddon.create({
      data: {
        name: body.name,
        price: body.price,
        groupName: body.groupName,
        required: body.required,
        maxQuantity: body.maxQuantity,
        ingredientId: body.ingredientId || null,
        ingredientQty: body.ingredientQty ?? null,
        sortOrder: body.sortOrder,
        active: body.active,
        productId: body.productId,
        tenantId,
      },
    })

    return created(res, addon)
  }),
)

/** PUT /api/menu/addons/:id */
router.put(
  '/addons/:id',
  requireStockAccess,
  validate({ body: addonSchema.partial().omit({ productId: true }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const id = String(req.params.id ?? '')

    const addon = await prisma.productAddon.findFirst({ where: { id, tenantId } })
    if (!addon) {
      return res.status(404).json({ success: false, error: 'Adicional nao encontrado.' })
    }

    const body = req.body as Partial<z.infer<typeof addonSchema>>

    const updated = await prisma.productAddon.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.price !== undefined && { price: body.price }),
        ...(body.groupName !== undefined && { groupName: body.groupName }),
        ...(body.required !== undefined && { required: body.required }),
        ...(body.maxQuantity !== undefined && { maxQuantity: body.maxQuantity }),
        ...(body.ingredientId !== undefined && { ingredientId: body.ingredientId || null }),
        ...(body.ingredientQty !== undefined && { ingredientQty: body.ingredientQty ?? null }),
        ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
        ...(body.active !== undefined && { active: body.active }),
      },
    })

    return ok(res, updated)
  }),
)

/** DELETE /api/menu/addons/:id */
router.delete(
  '/addons/:id',
  requireStockAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const id = String(req.params.id ?? '')

    const addon = await prisma.productAddon.findFirst({ where: { id, tenantId } })
    if (!addon) {
      return res.status(404).json({ success: false, error: 'Adicional nao encontrado.' })
    }

    await prisma.productAddon.delete({ where: { id } })
    return noContent(res)
  }),
)

export default router
