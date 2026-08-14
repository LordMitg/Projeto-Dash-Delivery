/**
 * Funcionarios do negocio ativo (`/api/users`).
 *
 * Substitui o antigo `POST /api/auth/register`. Somente o OWNER acessa: o dono
 * cria a conta do funcionario, escolhe exatamente o que ele pode fazer e pode
 * redefinir a senha dele.
 *
 * O funcionario entra com o mesmo login do dono (e-mail + senha) e recebe apenas
 * as permissoes marcadas no seu vinculo.
 */
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, ok, createdResponse, conflict, notFound, badRequest, requireAuth, serialize } from '../lib/http.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { validate, z } from '../lib/validate.js'
import { ALL_PERMISSIONS, PERMISSIONS, PERMISSION_GROUPS, ROLE_PRESETS, sanitizePermissions } from '../lib/permissions.js'

const router = Router()

// Toda a gestao de funcionarios e exclusiva do dono.
router.use(authenticate, requireAdmin)

// ---------------------------------------------------------------------------
// GET /api/users/permissions — catalogo para montar o formulario
// ---------------------------------------------------------------------------

router.get(
  '/permissions',
  asyncHandler(async (_req, res) =>
    ok(res, {
      permissions: ALL_PERMISSIONS.map((key) => ({ key, label: PERMISSIONS[key] })),
      groups: PERMISSION_GROUPS,
      presets: Object.entries(ROLE_PRESETS).map(([key, v]) => ({
        key,
        label: v.label,
        permissions: v.permissions,
      })),
    }),
  ),
)

// ---------------------------------------------------------------------------
// GET /api/users — funcionarios do negocio ativo
// ---------------------------------------------------------------------------

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)

    // Escopo pelo tenant ativo: um dono com duas lojas ve em cada tela apenas a
    // equipe daquela loja.
    const memberships = await prisma.membership.findMany({
      where: { tenantId: auth.tenantId },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, phone: true, active: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return ok(
      res,
      serialize(
        memberships.map((m) => ({
          membershipId: m.id,
          id: m.user.id,
          email: m.user.email,
          firstName: m.user.firstName,
          lastName: m.user.lastName,
          phone: m.user.phone,
          active: m.user.active,
          role: m.role,
          permissions: m.permissions,
          createdAt: m.user.createdAt,
          isMe: m.userId === auth.userId,
        })),
      ),
    )
  }),
)

// ---------------------------------------------------------------------------
// POST /api/users — cadastrar funcionario
// ---------------------------------------------------------------------------

const createSchema = z.object({
  firstName: z.string().min(1, 'Informe o nome').trim(),
  lastName: z.string().trim().default(''),
  email: z.string().email('E-mail inválido').toLowerCase().trim(),
  password: z.string().min(6, 'A senha deve ter ao menos 6 caracteres'),
  phone: z.string().trim().max(24).optional().default(''),
  vehicleType: z.enum(['moto', 'carro', 'bicicleta', 'a_pe']).optional().default('moto'),
  plate: z.string().trim().max(12).optional().default(''),
  /** Cargo apenas informativo, para pre-marcar as caixas. O que vale e `permissions`. */
  preset: z.string().trim().optional(),
  permissions: z.array(z.string()).default([]),
})

router.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const body = req.body as z.infer<typeof createSchema>

    const permissions = sanitizePermissions(body.permissions)

    // O e-mail e unico global. Se a conta ja existe, damos acesso a esta loja
    // criando um novo vinculo, em vez de recusar: e assim que a mesma pessoa
    // trabalha em duas lojas do mesmo dono.
    const existing = await prisma.user.findUnique({ where: { email: body.email } })

    if (existing) {
      const already = await prisma.membership.findFirst({
        where: { userId: existing.id, tenantId: auth.tenantId },
        select: { id: true },
      })
      if (already) throw conflict('Este e-mail já trabalha neste negócio')

      const membership = await prisma.membership.create({
        data: { userId: existing.id, tenantId: auth.tenantId, role: 'staff', permissions },
      })

      if (permissions.includes('delivery:drive')) {
        await prisma.fleet.create({
          data: {
            tenantId: auth.tenantId,
            driverUserId: existing.id,
            name: `${existing.firstName} ${existing.lastName}`.trim(),
            phone: body.phone || existing.phone,
            vehicleType: body.vehicleType,
            plate: body.plate ? body.plate.toUpperCase() : null,
          },
        })
      }

      return createdResponse(
        res,
        serialize({
          membershipId: membership.id,
          id: existing.id,
          email: existing.email,
          firstName: existing.firstName,
          lastName: existing.lastName,
          phone: existing.phone,
          active: existing.active,
          role: 'staff',
          permissions,
          // A senha continua sendo a que a pessoa ja usa: o dono desta loja nao
          // pode ver nem trocar a senha de uma conta que existe em outra.
          reusedExistingAccount: true,
        }),
      )
    }

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: body.email,
          password: await bcrypt.hash(body.password, 10),
          firstName: body.firstName,
          lastName: body.lastName,
          phone: body.phone || null,
          role: 'staff',
          active: true,
        },
      })

      const membership = await tx.membership.create({
        data: { userId: user.id, tenantId: auth.tenantId, role: 'staff', permissions },
      })

      if (permissions.includes('delivery:drive')) {
        await tx.fleet.create({
          data: {
            tenantId: auth.tenantId,
            driverUserId: user.id,
            name: `${body.firstName} ${body.lastName}`.trim(),
            phone: body.phone || null,
            vehicleType: body.vehicleType,
            plate: body.plate ? body.plate.toUpperCase() : null,
          },
        })
      }

      return { user, membership }
    })

    return createdResponse(
      res,
      serialize({
        membershipId: created.membership.id,
        id: created.user.id,
        email: created.user.email,
        firstName: created.user.firstName,
        lastName: created.user.lastName,
        phone: created.user.phone,
        active: created.user.active,
        role: 'staff',
        permissions,
      }),
    )
  }),
)

// ---------------------------------------------------------------------------
// PATCH /api/users/:membershipId — editar dados, permissoes ou senha
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  firstName: z.string().min(1).trim().optional(),
  lastName: z.string().trim().optional(),
  phone: z.string().trim().max(24).optional(),
  active: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
  /** Redefinicao de senha pelo dono: nao exige a senha antiga. */
  newPassword: z.string().min(6, 'A senha deve ter ao menos 6 caracteres').optional(),
})

router.patch(
  '/:membershipId',
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const membershipId = req.params.membershipId as string
    const body = req.body as z.infer<typeof updateSchema>

    // Escopo pelo tenant ativo: impede editar, mandando outro id, alguem que
    // pertence a uma loja diferente.
    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, tenantId: auth.tenantId },
      include: { user: { select: { id: true, email: true } } },
    })
    if (!membership) throw notFound('Funcionário não encontrado')

    if (membership.role === 'owner') {
      // Dono nao se rebaixa nem se desativa pela tela de equipe: a loja ficaria
      // sem ninguem capaz de gerenciar acesso.
      if (body.permissions !== undefined || body.active === false) {
        throw badRequest('O dono do negócio não pode ter o próprio acesso alterado aqui.')
      }
    }

    // Uma conta que existe em varias lojas nao pode ter a senha trocada pelo
    // dono de uma delas — isso daria acesso as outras.
    if (body.newPassword) {
      const otherLinks = await prisma.membership.count({
        where: { userId: membership.user.id, tenantId: { not: auth.tenantId } },
      })
      if (otherLinks > 0) {
        throw badRequest(
          'Esta conta também trabalha em outro negócio. Por segurança, a senha só pode ser trocada pela própria pessoa.',
        )
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.firstName !== undefined || body.lastName !== undefined || body.phone !== undefined || body.active !== undefined || body.newPassword) {
        await tx.user.update({
          where: { id: membership.user.id },
          data: {
            ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
            ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
            ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
            ...(body.newPassword ? { password: await bcrypt.hash(body.newPassword, 10) } : {}),
          },
        })
      }

      if (body.permissions !== undefined && membership.role !== 'owner') {
        await tx.membership.update({
          where: { id: membership.id },
          data: { permissions: sanitizePermissions(body.permissions) },
        })
      }


      const nextPermissions = body.permissions !== undefined ? sanitizePermissions(body.permissions) : membership.permissions
      if (nextPermissions.includes('delivery:drive')) {
        const user = await tx.user.findUniqueOrThrow({ where: { id: membership.user.id } })
        const profile = await tx.fleet.findFirst({ where: { tenantId: auth.tenantId, driverUserId: user.id } })
        if (profile) {
          await tx.fleet.update({ where: { id: profile.id }, data: { active: true, name: `${user.firstName} ${user.lastName}`.trim(), phone: user.phone } })
        } else {
          await tx.fleet.create({ data: { tenantId: auth.tenantId, driverUserId: user.id, name: `${user.firstName} ${user.lastName}`.trim(), phone: user.phone } })
        }
      }

      return tx.membership.findUnique({
        where: { id: membership.id },
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true, active: true } },
        },
      })
    })

    return ok(
      res,
      serialize({
        membershipId: updated!.id,
        id: updated!.user.id,
        email: updated!.user.email,
        firstName: updated!.user.firstName,
        lastName: updated!.user.lastName,
        phone: updated!.user.phone,
        active: updated!.user.active,
        role: updated!.role,
        permissions: updated!.permissions,
      }),
    )
  }),
)

// ---------------------------------------------------------------------------
// DELETE /api/users/:membershipId — remover acesso a este negocio
// ---------------------------------------------------------------------------

router.delete(
  '/:membershipId',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const membershipId = req.params.membershipId as string

    const membership = await prisma.membership.findFirst({
      where: { id: membershipId, tenantId: auth.tenantId },
    })
    if (!membership) throw notFound('Funcionário não encontrado')

    if (membership.role === 'owner') {
      throw badRequest('O dono não pode remover o próprio acesso ao negócio.')
    }

    // Remove apenas o VINCULO, nao a conta: os pedidos lancados por essa pessoa
    // continuam apontando para ela no historico. Apagar o usuario deixaria o
    // relatorio de vendas sem autor.
    await prisma.membership.delete({ where: { id: membership.id } })

    return ok(res, { removed: true })
  }),
)

export default router
