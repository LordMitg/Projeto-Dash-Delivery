/**
 * Clientes.
 *
 * O PDV ja chamava `GET /api/customers?phone=...` para reconhecer quem liga —
 * mas a rota nunca existiu e devolvia 404. O `if (res.ok)` do frontend engolia
 * o erro, entao o operador via o formulario de "novo cliente" mesmo para um
 * cliente antigo, e o cadastro era duplicado a cada pedido.
 *
 * Devolve `neighborhood` para o PDV aplicar a taxa do bairro automaticamente.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, ok, notFound } from '../lib/http.js'
import { validate } from '../lib/validate.js'

const router = Router()

/** Campos expostos: nada de `notes`, que e uso interno. */
const publicFields = {
  id: true,
  name: true,
  phone: true,
  address: true,
  neighborhood: true,
  city: true,
  state: true,
  zipCode: true,
  ltv: true,
  totalOrders: true,
  lastOrderAt: true,
} as const

const listQuery = z.object({
  /** Busca por telefone (parcial) — o caso do PDV atendendo uma ligacao. */
  phone: z.string().trim().min(3).optional(),
  /** Busca por nome (parcial, sem diferenciar maiuscula). */
  name: z.string().trim().min(2).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

/**
 * GET /api/customers?phone=...
 * Sempre filtrado pelo tenant da sessao: um telefone de outra loja nunca
 * aparece aqui.
 */
router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const { phone, name, limit } = req.query as unknown as {
      phone?: string
      name?: string
      limit: number
    }

    // Sem criterio, devolve os mais recentes em vez da tabela inteira.
    const where = {
      tenantId,
      ...(phone ? { phone: { contains: phone } } : {}),
      ...(name ? { name: { contains: name, mode: 'insensitive' as const } } : {}),
    }

    const customers = await prisma.customer.findMany({
      where,
      select: publicFields,
      orderBy: { lastOrderAt: 'desc' },
      take: limit,
    })

    return ok(res, customers)
  }),
)

/** GET /api/customers/:id — ficha do cliente com os ultimos pedidos. */
router.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const { id } = req.params

    const customer = await prisma.customer.findFirst({
      // `tenantId` no filtro, nao so o id: sem isso um id valido de outra loja
      // vazaria o cadastro dela.
      where: { id, tenantId },
      select: {
        ...publicFields,
        orders: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalAmount: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    })

    if (!customer) throw notFound('Cliente nao encontrado.')

    return ok(res, customer)
  }),
)

export default router
