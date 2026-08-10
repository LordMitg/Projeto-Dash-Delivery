/**
 * Negocios da conta (`/api/tenants`).
 *
 * Lista os negocios do usuario logado, cria novos e edita o perfil da loja
 * (tela "Meu negócio"). Criar negocio esta liberado para qualquer conta
 * autenticada — quem cria e sempre `owner` do que criou.
 */
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, ok, createdResponse, notFound, badRequest, forbidden, requireAuth, serialize } from '../lib/http.js'
import { authenticate, signToken } from '../middleware/auth.js'
import { validate, z } from '../lib/validate.js'
import { slugify } from '../lib/slug.js'
// Reusa o schema de horarios em vez de aceitar `any`: um JSON fora do formato
// era gravado sem reclamacao e depois caia no fallback de `computeStoreStatus`,
// fazendo a loja se comportar como se nao tivesse horario configurado.
import { openingHoursSchema } from '../services/storeService.js'

const router = Router()

router.use(authenticate)

/** Limite do data URL do logo (~300KB de texto). */
const MAX_LOGO_CHARS = 400_000

const tenantSelect = {
  id: true,
  name: true,
  slug: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  zipCode: true,
  logoData: true,
  openingHours: true,
  isOpen: true,
  deliveryFeeBase: true,
  deliveryZones: true,
  printSettings: true,
} as const

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'negocio'
  let candidate = base
  let n = 1
  while (await prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    n += 1
    candidate = `${base}-${n}`
  }
  return candidate
}

/**
 * Garante que o usuario e OWNER do negocio informado.
 *
 * Toda escrita passa por aqui: sem esta checagem, trocar o id na URL permitiria
 * editar a loja de outro dono.
 */
async function requireOwnership(userId: string, tenantId: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId, tenantId },
    select: { role: true },
  })
  if (!membership) throw notFound('Negócio não encontrado')
  if (membership.role !== 'owner') throw forbidden('Apenas o dono pode alterar os dados do negócio')
}

// ---------------------------------------------------------------------------
// GET /api/tenants — negocios da conta
// ---------------------------------------------------------------------------

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const memberships = await prisma.membership.findMany({
      where: { userId: auth.userId, tenant: { active: true } },
      include: { tenant: { select: tenantSelect } },
      orderBy: { createdAt: 'asc' },
    })

    return ok(
      res,
      serialize(
        memberships.map((m) => ({
          ...m.tenant,
          role: m.role,
          permissions: m.permissions,
          isActive: m.tenantId === auth.tenantId,
        })),
      ),
    )
  }),
)

// ---------------------------------------------------------------------------
// GET /api/tenants/current — negocio ativo (tela "Meu negócio")
// ---------------------------------------------------------------------------

router.get(
  '/current',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const tenant = await prisma.tenant.findUnique({
      where: { id: auth.tenantId },
      select: tenantSelect,
    })
    if (!tenant) throw notFound('Negócio não encontrado')
    return ok(res, serialize({ ...tenant, role: auth.role }))
  }),
)

// ---------------------------------------------------------------------------
// POST /api/tenants — adicionar outro negocio
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().min(2, 'Informe o nome do negócio').trim(),
  logoData: z.string().trim().optional(),
  openingHours: openingHoursSchema.optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  zipCode: z.string().trim().optional(),
})

router.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const body = req.body as z.infer<typeof createSchema>

    if (body.logoData && body.logoData.length > MAX_LOGO_CHARS) {
      throw badRequest('A imagem do logo é muito grande. Envie uma imagem menor.')
    }

    const slug = await uniqueSlug(body.name)

    // Negocio e vinculo na mesma transacao: uma loja sem dono seria inacessivel
    // e nao apareceria em nenhuma listagem.
    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name: body.name,
          slug,
          email: auth.email,
          ...(body.phone ? { phone: body.phone } : {}),
          ...(body.address ? { address: body.address } : {}),
          ...(body.city ? { city: body.city } : {}),
          ...(body.state ? { state: body.state } : {}),
          ...(body.zipCode ? { zipCode: body.zipCode } : {}),
          ...(body.logoData ? { logoData: body.logoData } : {}),
          ...(body.openingHours ? { openingHours: body.openingHours } : {}),
        },
        select: tenantSelect,
      })

      await tx.membership.create({
        data: { userId: auth.userId, tenantId: created.id, role: 'owner', permissions: [] },
      })

      return created
    })

    return createdResponse(res, serialize(tenant))
  }),
)

// ---------------------------------------------------------------------------
// PATCH /api/tenants/:id — editar perfil da loja
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  name: z.string().min(2, 'Informe o nome do negócio').trim().optional(),
  logoData: z.string().trim().nullable().optional(),
  openingHours: openingHoursSchema.optional(),
  phone: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  city: z.string().trim().nullable().optional(),
  state: z.string().trim().nullable().optional(),
  zipCode: z.string().trim().nullable().optional(),
  isOpen: z.boolean().optional(),
})

router.patch(
  '/:id',
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const id = req.params.id as string
    await requireOwnership(auth.userId, id)

    const body = req.body as z.infer<typeof updateSchema>

    if (body.logoData && body.logoData.length > MAX_LOGO_CHARS) {
      throw badRequest('A imagem do logo é muito grande. Envie uma imagem menor.')
    }

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        // O `slug` NAO acompanha a renomeacao: ele identifica a loja em links
        // do cardapio publico que podem estar salvos por clientes.
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.logoData !== undefined ? { logoData: body.logoData } : {}),
        ...(body.openingHours !== undefined ? { openingHours: body.openingHours } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.state !== undefined ? { state: body.state } : {}),
        ...(body.zipCode !== undefined ? { zipCode: body.zipCode } : {}),
        ...(body.isOpen !== undefined ? { isOpen: body.isOpen } : {}),
      },
      select: tenantSelect,
    })

    return ok(res, serialize(tenant))
  }),
)

// ---------------------------------------------------------------------------
// POST /api/tenants/:id/activate — alterna e devolve novo token
// ---------------------------------------------------------------------------
//
// Espelha `/api/auth/switch-tenant`; mantido aqui para o frontend poder alternar
// logo apos criar um negocio, sem uma segunda chamada.

router.post(
  '/:id/activate',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const id = req.params.id as string

    const membership = await prisma.membership.findFirst({
      where: { userId: auth.userId, tenantId: id, tenant: { active: true } },
      include: { tenant: { select: tenantSelect } },
    })
    if (!membership) throw notFound('Você não tem acesso a este negócio')

    const token = signToken({
      userId: auth.userId,
      tenantId: membership.tenantId,
      email: auth.email,
      role: membership.role,
      membershipId: membership.id,
    })

    return ok(res, serialize({ token, tenant: membership.tenant, role: membership.role, permissions: membership.permissions }))
  }),
)

export default router
