/**
 * Rotas de insumos (estoque de materia-prima).
 *
 * BUGS CORRIGIDOS:
 *  1. Importava `verifyTenant`, que NAO EXISTE em middleware/tenant.ts.
 *     Isso derrubava o processo inteiro do backend na inicializacao.
 *  2. Os paths eram '/ingredients', mas o router e montado em '/api/ingredients',
 *     gerando '/api/ingredients/ingredients'. Nenhuma chamada do frontend batia.
 *  3. `parseInt(stock)` truncava o estoque: 2,5 kg virava 2 kg.
 *     Agora estoque e Decimal e aceita fracao.
 *  4. Sem validacao: campo ausente virava NaN e estourava 500.
 */
import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import {
  asyncHandler,
  ok,
  createdResponse,
  notFound,
  conflict,
  tenantOf,
  serialize,
} from '../lib/http.js'
import { requireStockAccess } from '../middleware/auth.js'
import { validate, z, idParam, money, quantity, booleanish } from '../lib/validate.js'

const router = Router()

const dec = (v: number) => new Prisma.Decimal(v.toFixed(4))

// ---------------------------------------------------------------------------
// GET /api/ingredients — lista
// ---------------------------------------------------------------------------

const listQuery = z.object({
  search: z.string().trim().optional(),
  active: booleanish.optional(),
  lowStock: booleanish.optional(),
})

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const { search, active, lowStock } = req.query as unknown as z.infer<typeof listQuery>

    const where: Prisma.IngredientWhereInput = { tenantId }
    if (active !== undefined) where.active = active
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search } },
      ]
    }

    const ingredients = await prisma.ingredient.findMany({
      where,
      orderBy: { name: 'asc' },
    })

    // Filtro de estoque baixo feito em memoria: o Prisma nao compara duas
    // colunas da mesma tabela diretamente no `where`.
    const result = lowStock
      ? ingredients.filter((i) => Number(i.stock) <= Number(i.minimumStock))
      : ingredients

    return ok(res, serialize(result))
  }),
)

// ---------------------------------------------------------------------------
// GET /api/ingredients/movements — livro de estoque
// ---------------------------------------------------------------------------

const movementListQuery = z.object({
  ingredientId: z.string().trim().optional(),
  type: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

router.get(
  '/movements',
  validate({ query: movementListQuery }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const { ingredientId, type, limit } = req.query as unknown as z.infer<typeof movementListQuery>

    const movements = await prisma.stockMovement.findMany({
      where: {
        tenantId,
        ...(ingredientId ? { ingredientId } : {}),
        ...(type ? { type } : {}),
      },
      include: {
        ingredient: { select: { id: true, name: true, unit: true, sku: true } },
        actor: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return ok(res, serialize(movements))
  }),
)

// ---------------------------------------------------------------------------
// GET /api/ingredients/barcode/:code — usado pelo scanner do celular
// ---------------------------------------------------------------------------

router.get(
  '/barcode/:code',
  validate({ params: z.object({ code: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const { code } = req.params

    const ingredient = await prisma.ingredient.findFirst({
      where: { barcode: code, tenantId },
    })
    if (!ingredient) throw notFound(`Nenhum insumo com o codigo ${code}`)

    return ok(res, serialize(ingredient))
  }),
)

// ---------------------------------------------------------------------------
// GET /api/ingredients/:id
// ---------------------------------------------------------------------------

router.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)

    const ingredient = await prisma.ingredient.findFirst({
      where: { id: req.params.id, tenantId },
      include: {
        productIngredients: {
          include: { product: { select: { id: true, name: true, sku: true } } },
        },
      },
    })
    if (!ingredient) throw notFound('Insumo nao encontrado')

    return ok(res, serialize(ingredient))
  }),
)

// ---------------------------------------------------------------------------
// POST /api/ingredients
// ---------------------------------------------------------------------------

const upsertSchema = z.object({
  name: z.string().min(1, 'Informe o nome do insumo').trim(),
  description: z.string().trim().nullish(),
  sku: z.string().min(1, 'Informe o SKU').trim().toUpperCase(),
  barcode: z
    .string()
    .trim()
    .regex(/^\d{8,14}$/, 'Codigo de barras deve ter de 8 a 14 digitos')
    .nullish(),
  unit: z.enum(['kg', 'g', 'l', 'ml', 'un', 'cx', 'pct'], {
    errorMap: () => ({ message: 'Unidade invalida (use kg, g, l, ml, un, cx ou pct)' }),
  }),
  price: money,
  breakageFactor: numericPercent(),
  stock: quantity.default(0),
  minimumStock: quantity.default(0),
  active: z.boolean().default(true),
})

/** Percentual de perda: 0 a 100. */
function numericPercent() {
  return z.coerce.number().min(0, 'Perda nao pode ser negativa').max(100, 'Perda nao pode passar de 100%').default(0)
}

router.post(
  '/',
  requireStockAccess,
  validate({ body: upsertSchema }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const body = req.body as z.infer<typeof upsertSchema>

    const dupSku = await prisma.ingredient.findFirst({ where: { sku: body.sku, tenantId } })
    if (dupSku) throw conflict(`O SKU ${body.sku} ja esta em uso`)

    if (body.barcode) {
      const dupBarcode = await prisma.ingredient.findFirst({
        where: { barcode: body.barcode, tenantId },
      })
      if (dupBarcode) {
        throw conflict(`O codigo de barras ${body.barcode} ja pertence a "${dupBarcode.name}"`)
      }
    }

    const ingredient = await prisma.$transaction(async (tx) => {
      const newIngredient = await tx.ingredient.create({
        data: {
          name: body.name,
          description: body.description ?? null,
          sku: body.sku,
          barcode: body.barcode ?? null,
          unit: body.unit,
          price: dec(body.price),
          breakageFactor: dec(body.breakageFactor),
          stock: dec(body.stock),
          minimumStock: dec(body.minimumStock),
          active: body.active,
          tenantId,
        },
      })

      if (body.stock !== 0) {
        await tx.stockMovement.create({
          data: {
            type: 'initial',
            delta: dec(body.stock),
            balanceBefore: dec(0),
            balanceAfter: dec(body.stock),
            reason: 'Saldo inicial do cadastro',
            tenantId,
            ingredientId: newIngredient.id,
            actorId: req.auth!.userId,
          },
        })
      }

      return newIngredient
    })

    return createdResponse(res, serialize(ingredient))
  }),
)

// ---------------------------------------------------------------------------
// PUT /api/ingredients/:id
// ---------------------------------------------------------------------------

router.put(
  '/:id',
  requireStockAccess,
  validate({ params: idParam, body: upsertSchema.partial() }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const id = String(req.params.id ?? '')
    const body = req.body as Partial<z.infer<typeof upsertSchema>>

    const current = await prisma.ingredient.findFirst({ where: { id, tenantId } })
    if (!current) throw notFound('Insumo nao encontrado')

    if (body.sku && body.sku !== current.sku) {
      const dup = await prisma.ingredient.findFirst({
        where: { sku: body.sku, tenantId, id: { not: id } },
      })
      if (dup) throw conflict(`O SKU ${body.sku} ja esta em uso`)
    }

    if (body.barcode && body.barcode !== current.barcode) {
      const dup = await prisma.ingredient.findFirst({
        where: { barcode: body.barcode, tenantId, id: { not: id } },
      })
      if (dup) throw conflict(`O codigo de barras ${body.barcode} ja pertence a "${dup.name}"`)
    }

    const data: Prisma.IngredientUpdateInput = {}
    if (body.name !== undefined) data.name = body.name
    if (body.description !== undefined) data.description = body.description ?? null
    if (body.sku !== undefined) data.sku = body.sku
    if (body.barcode !== undefined) data.barcode = body.barcode ?? null
    if (body.unit !== undefined) data.unit = body.unit
    if (body.price !== undefined) data.price = dec(body.price)
    if (body.breakageFactor !== undefined) data.breakageFactor = dec(body.breakageFactor)
    if (body.stock !== undefined) data.stock = dec(body.stock)
    if (body.minimumStock !== undefined) data.minimumStock = dec(body.minimumStock)
    if (body.active !== undefined) data.active = body.active

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.ingredient.update({ where: { id }, data })
      if (body.stock !== undefined && body.stock !== Number(current.stock)) {
        await tx.stockMovement.create({
          data: {
            type: 'adjustment',
            delta: dec(body.stock - Number(current.stock)),
            balanceBefore: current.stock,
            balanceAfter: dec(body.stock),
            reason: 'Saldo corrigido na edição do insumo',
            tenantId,
            ingredientId: id,
            actorId: req.auth!.userId,
          },
        })
      }
      return saved
    })
    return ok(res, serialize(updated))
  }),
)

// ---------------------------------------------------------------------------
// POST /api/ingredients/:id/stock — entrada/ajuste de estoque
// ---------------------------------------------------------------------------
//
// Usado pelo scanner: bipa a embalagem, informa a quantidade, da entrada.

const stockSchema = z.object({
  // Positivo = entrada de mercadoria; negativo = baixa/perda.
  delta: z.coerce.number().refine((n) => n !== 0, 'Informe uma quantidade diferente de zero'),
  type: z.enum(['entry', 'exit', 'adjustment', 'loss']).optional(),
  reason: z.string().trim().min(2, 'Informe o motivo').max(200),
})

router.post(
  '/:id/stock',
  requireStockAccess,
  validate({ params: idParam, body: stockSchema }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const id = String(req.params.id ?? '')
    const { delta, type, reason } = req.body as z.infer<typeof stockSchema>

    const current = await prisma.ingredient.findFirst({ where: { id, tenantId } })
    if (!current) throw notFound('Insumo nao encontrado')

    const novoEstoque = Number(current.stock) + delta
    if (novoEstoque < 0) {
      throw conflict(
        `Estoque insuficiente: ha ${Number(current.stock)} ${current.unit} de "${current.name}"`,
      )
    }

    const movementType = type ?? (delta > 0 ? 'entry' : 'exit')
    if (movementType === 'entry' && delta < 0) {
      throw conflict('Uma entrada precisa aumentar o saldo.')
    }
    if ((movementType === 'exit' || movementType === 'loss') && delta > 0) {
      throw conflict('Uma saida ou perda precisa reduzir o saldo.')
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.ingredient.update({
        where: { id },
        data: { stock: dec(novoEstoque) },
      })
      await tx.stockMovement.create({
        data: {
          type: movementType,
          delta: dec(delta),
          balanceBefore: current.stock,
          balanceAfter: dec(novoEstoque),
          reason,
          tenantId,
          ingredientId: id,
          actorId: req.auth!.userId,
        },
      })
      return saved
    })

    return ok(res, serialize(updated))
  }),
)

// ---------------------------------------------------------------------------
// DELETE /api/ingredients/:id
// ---------------------------------------------------------------------------

router.delete(
  '/:id',
  requireStockAccess,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const id = String(req.params.id ?? '')

    const ingredient = await prisma.ingredient.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { productIngredients: true, invoiceItems: true } } },
    })
    if (!ingredient) throw notFound('Insumo nao encontrado')

    // Nao apaga insumo em uso: isso apagaria em cascata a ficha tecnica dos
    // produtos e o CMV historico. Desativa em vez de excluir.
    if (ingredient._count.productIngredients > 0 || ingredient._count.invoiceItems > 0) {
      const updated = await prisma.ingredient.update({
        where: { id },
        data: { active: false },
      })
      return ok(res, {
        deactivated: true,
        message: `"${ingredient.name}" esta em uso em ${ingredient._count.productIngredients} ficha(s) tecnica(s), por isso foi desativado em vez de excluido.`,
        ingredient: serialize(updated),
      })
    }

    await prisma.ingredient.delete({ where: { id } })
    return ok(res, { deleted: id })
  }),
)

export default router
