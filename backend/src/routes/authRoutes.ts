/**
 * Rotas de autenticacao.
 *
 * Modelo de acesso: uma conta (`User`) pode estar ligada a varios negocios
 * (`Tenant`) atraves de `Membership`. O JWT carrega o negocio ATIVO; alternar
 * de loja reemite o token.
 *
 * O login nao pede mais `tenantSlug`: o e-mail passou a ser unico global, entao
 * a conta e resolvida direto e os negocios dela vem na resposta.
 */
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, ok, unauthorized, conflict, notFound, badRequest, requireAuth, serialize } from '../lib/http.js'
import { authenticate, signToken } from '../middleware/auth.js'
import { validate, z } from '../lib/validate.js'
import { authLimiter, recoveryLimiter } from '../middleware/rateLimit.js'
import {
  SECURITY_QUESTIONS,
  SECURITY_QUESTION_KEYS,
  normalizeAnswer,
  type SecurityQuestionKey,
} from '../lib/securityQuestions.js'
import { slugify } from '../lib/slug.js'

const router = Router()

/** Campos do negocio devolvidos ao frontend. */
const tenantSelect = {
  id: true,
  name: true,
  slug: true,
  isOpen: true,
  logoData: true,
  openingHours: true,
  address: true,
  city: true,
  state: true,
  zipCode: true,
  phone: true,
  deliveryFeeBase: true,
  deliveryZones: true,
  printSettings: true,
  couponsEnabled: true,
  loyaltyPointsEnabled: true,
  cashbackEnabled: true,
  pointsPerReal: true,
  pointRedemptionValue: true,
  cashbackPercent: true,
} as const

/** Monta a lista de negocios da conta, para o alternador do cabecalho. */
async function listUserTenants(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId, tenant: { active: true } },
    include: { tenant: { select: { id: true, name: true, slug: true, logoData: true, isOpen: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return memberships.map((m) => ({
    id: m.tenant.id,
    name: m.tenant.name,
    slug: m.tenant.slug,
    logoData: m.tenant.logoData,
    isOpen: m.tenant.isOpen,
    role: m.role,
  }))
}

// ---------------------------------------------------------------------------
// POST /api/auth/signup — cadastro publico do dono + primeiro negocio
// ---------------------------------------------------------------------------

const signupSchema = z
  .object({
    firstName: z.string().min(1, 'Informe seu nome').trim(),
    lastName: z.string().trim().default(''),
    email: z.string().email('E-mail invalido').toLowerCase().trim(),
    password: z.string().min(6, 'A senha deve ter ao menos 6 caracteres'),
    businessName: z.string().min(2, 'Informe o nome do negócio').trim(),
    // Opcionais: o dono completa depois em "Meu negócio". Cadastro curto reduz
    // desistencia, e nada aqui bloqueia o uso do sistema.
    logoData: z.string().trim().optional(),
    openingHours: z.any().optional(),
    address: z.string().trim().optional(),
    city: z.string().trim().optional(),
    state: z.string().trim().optional(),
    zipCode: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    question1: z.enum(SECURITY_QUESTION_KEYS as [string, ...string[]]),
    answer1: z.string().min(2, 'Responda a primeira pergunta').trim(),
    question2: z.enum(SECURITY_QUESTION_KEYS as [string, ...string[]]),
    answer2: z.string().min(2, 'Responda a segunda pergunta').trim(),
  })
  .refine((d) => d.question1 !== d.question2, {
    message: 'Escolha duas perguntas diferentes',
    path: ['question2'],
  })

router.post(
  '/signup',
  authLimiter,
  validate({ body: signupSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof signupSchema>

    const exists = await prisma.user.findUnique({ where: { email: body.email } })
    if (exists) throw conflict('Este e-mail já está cadastrado')

    // Logo vem como data URL. Limite defensivo: o payload inteiro precisa caber
    // no body do Express e a coluna guarda texto.
    if (body.logoData && body.logoData.length > 400_000) {
      throw badRequest('A imagem do logo é muito grande. Envie uma imagem menor.')
    }

    const slug = await uniqueSlug(body.businessName)

    // Transacao: conta, negocio e vinculo nascem juntos. Se qualquer passo
    // falhar, nao queremos uma conta sem loja (nem loja sem dono).
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: body.businessName,
          slug,
          email: body.email,
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

      const user = await tx.user.create({
        data: {
          email: body.email,
          password: await bcrypt.hash(body.password, 10),
          firstName: body.firstName,
          lastName: body.lastName,
          role: 'owner',
          active: true,
          securityQuestion1: body.question1,
          securityQuestion2: body.question2,
          // Respostas normalizadas antes do hash, senao acento/maiuscula
          // impediriam a recuperacao depois.
          securityAnswer1Hash: await bcrypt.hash(normalizeAnswer(body.answer1), 10),
          securityAnswer2Hash: await bcrypt.hash(normalizeAnswer(body.answer2), 10),
        },
      })

      const membership = await tx.membership.create({
        data: { userId: user.id, tenantId: tenant.id, role: 'owner', permissions: [] },
      })

      return { tenant, user, membership }
    })

    const token = signToken({
      userId: result.user.id,
      tenantId: result.tenant.id,
      email: result.user.email,
      role: 'owner',
      membershipId: result.membership.id,
    })

    return ok(
      res,
      serialize({
        token,
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          role: 'owner',
          permissions: [],
        },
        tenant: result.tenant,
        tenants: [
          {
            id: result.tenant.id,
            name: result.tenant.name,
            slug: result.tenant.slug,
            logoData: result.tenant.logoData,
            isOpen: result.tenant.isOpen,
            role: 'owner',
          },
        ],
      }),
    )
  }),
)

/** Gera um slug livre, numerando em caso de colisao (o slug e unico). */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'negocio'
  let candidate = base
  let n = 1
  // Nomes repetidos entre donos diferentes sao permitidos; o slug e que precisa
  // ser unico, por isso o sufixo numerico.
  while (await prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    n += 1
    candidate = `${base}-${n}`
  }
  return candidate
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().min(1, 'Informe o e-mail').toLowerCase().trim(),
  password: z.string().min(1, 'Informe a senha'),
  /** Negocio preferido (ultimo usado). Se ausente, entra no primeiro vinculo. */
  tenantId: z.string().trim().optional(),
})

router.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password, tenantId } = req.body as z.infer<typeof loginSchema>

    const user = await prisma.user.findUnique({ where: { email } })

    // Compara sempre um hash, mesmo sem usuario, para o tempo de resposta nao
    // revelar quais e-mails existem (timing attack).
    const hashToCompare = user?.password ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv'
    const valid = await bcrypt.compare(password, hashToCompare)

    if (!user || !valid) throw unauthorized('E-mail ou senha incorretos')
    if (!user.active) throw unauthorized('Conta desativada. Fale com o dono do negócio.')

    const memberships = await prisma.membership.findMany({
      where: { userId: user.id, tenant: { active: true } },
      include: { tenant: { select: tenantSelect } },
      orderBy: { createdAt: 'asc' },
    })

    // Conta sem negocio: acontece se o dono apagar a ultima loja. O frontend
    // usa `needsBusiness` para levar direto ao cadastro de negocio, em vez de
    // mostrar uma dash vazia e sem saida.
    if (memberships.length === 0) {
      return ok(res, {
        needsBusiness: true,
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName },
      })
    }

    const active = memberships.find((m) => m.tenantId === tenantId) ?? memberships[0]!

    const token = signToken({
      userId: user.id,
      tenantId: active.tenantId,
      email: user.email,
      role: active.role,
      membershipId: active.id,
    })

    return ok(
      res,
      serialize({
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: active.role,
          permissions: active.permissions,
          // Sinaliza que a conta nao tem perguntas definidas (usuarios criados
          // antes desta versao). A dash pede para configurar.
          needsSecurityQuestions: !user.securityQuestion1 || !user.securityQuestion2,
        },
        tenant: active.tenant,
        tenants: memberships.map((m) => ({
          id: m.tenant.id,
          name: m.tenant.name,
          slug: m.tenant.slug,
          logoData: m.tenant.logoData,
          isOpen: m.tenant.isOpen,
          role: m.role,
        })),
      }),
    )
  }),
)

// ---------------------------------------------------------------------------
// POST /api/auth/switch-tenant — alterna o negocio ativo
// ---------------------------------------------------------------------------

router.post(
  '/switch-tenant',
  authenticate,
  validate({ body: z.object({ tenantId: z.string().min(1, 'Informe o negócio') }) }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const { tenantId } = req.body as { tenantId: string }

    // Confirma o vinculo antes de emitir o token: sem esta checagem, qualquer
    // usuario trocaria para a loja de outro dono mandando o id na mao.
    const membership = await prisma.membership.findFirst({
      where: { userId: auth.userId, tenantId, tenant: { active: true } },
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

    // Devolve `user` no mesmo formato do login: papel e permissoes mudam junto
    // com a loja, e o frontend so precisa entender um formato de resposta.
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true, firstName: true, lastName: true },
    })

    return ok(
      res,
      serialize({
        token,
        tenant: membership.tenant,
        user: { ...user, role: membership.role, permissions: membership.permissions },
      }),
    )
  }),
)

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)

    const user = await prisma.user.findUnique({ where: { id: auth.userId } })
    if (!user || !user.active) throw unauthorized('Usuario nao encontrado ou desativado')

    const membership = await prisma.membership.findFirst({
      where: { userId: auth.userId, tenantId: auth.tenantId },
      include: { tenant: { select: tenantSelect } },
    })
    if (!membership) throw unauthorized('Seu acesso a este negócio foi removido')

    return ok(
      res,
      serialize({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: membership.role,
          permissions: membership.permissions,
          needsSecurityQuestions: !user.securityQuestion1 || !user.securityQuestion2,
        },
        tenant: membership.tenant,
        tenants: await listUserTenants(auth.userId),
      }),
    )
  }),
)

// ---------------------------------------------------------------------------
// Recuperacao de senha por perguntas de seguranca
// ---------------------------------------------------------------------------

/** Catalogo das perguntas, para as telas de cadastro e recuperacao. */
router.get(
  '/security-questions',
  asyncHandler(async (_req, res) =>
    ok(res, {
      questions: SECURITY_QUESTION_KEYS.map((key) => ({ key, label: SECURITY_QUESTIONS[key] })),
    }),
  ),
)

const MAX_RECOVERY_ATTEMPTS = 5
const LOCK_MINUTES = 15

/** Passo 1: descobrir quais perguntas a conta cadastrou. */
router.post(
  '/recovery/questions',
  recoveryLimiter,
  validate({ body: z.object({ email: z.string().min(1, 'Informe o e-mail').toLowerCase().trim() }) }),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string }
    const user = await prisma.user.findUnique({ where: { email } })

    // Resposta identica para e-mail inexistente e para conta sem perguntas:
    // qualquer diferenca aqui viraria um verificador de cadastro.
    if (!user || !user.securityQuestion1 || !user.securityQuestion2) {
      throw notFound('Não encontramos uma conta com recuperação por perguntas para este e-mail.')
    }

    if (user.recoveryLockedUntil && user.recoveryLockedUntil > new Date()) {
      throw unauthorized('Muitas tentativas. Tente novamente mais tarde.')
    }

    return ok(res, {
      email: user.email,
      questions: [
        { key: user.securityQuestion1, label: SECURITY_QUESTIONS[user.securityQuestion1 as SecurityQuestionKey] },
        { key: user.securityQuestion2, label: SECURITY_QUESTIONS[user.securityQuestion2 as SecurityQuestionKey] },
      ],
    })
  }),
)

/** Passo 2: as DUAS respostas corretas trocam a senha. */
router.post(
  '/recovery/reset',
  recoveryLimiter,
  validate({
    body: z.object({
      email: z.string().min(1, 'Informe o e-mail').toLowerCase().trim(),
      answer1: z.string().min(1, 'Responda a primeira pergunta'),
      answer2: z.string().min(1, 'Responda a segunda pergunta'),
      newPassword: z.string().min(6, 'A nova senha deve ter ao menos 6 caracteres'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { email, answer1, answer2, newPassword } = req.body as {
      email: string
      answer1: string
      answer2: string
      newPassword: string
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.securityAnswer1Hash || !user.securityAnswer2Hash) {
      throw unauthorized('Não foi possível recuperar a conta. Verifique os dados.')
    }

    if (user.recoveryLockedUntil && user.recoveryLockedUntil > new Date()) {
      throw unauthorized('Muitas tentativas. Tente novamente mais tarde.')
    }

    // Exige as DUAS respostas. Uma so seria fragil: nome de animal e cidade
    // natal costumam estar publicos na rede social do dono.
    const [ok1, ok2] = await Promise.all([
      bcrypt.compare(normalizeAnswer(answer1), user.securityAnswer1Hash),
      bcrypt.compare(normalizeAnswer(answer2), user.securityAnswer2Hash),
    ])

    if (!ok1 || !ok2) {
      const attempts = user.recoveryAttempts + 1
      await prisma.user.update({
        where: { id: user.id },
        data: {
          recoveryAttempts: attempts,
          // Trava temporaria ao estourar o limite: respostas sao curtas e de um
          // conjunto pequeno, entao sem trava daria para varrer por tentativa.
          ...(attempts >= MAX_RECOVERY_ATTEMPTS
            ? { recoveryLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000), recoveryAttempts: 0 }
            : {}),
        },
      })
      throw unauthorized('Respostas incorretas.')
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        recoveryAttempts: 0,
        recoveryLockedUntil: null,
      },
    })

    return ok(res, { reset: true })
  }),
)

// ---------------------------------------------------------------------------
// POST /api/auth/security-questions — definir/atualizar as proprias perguntas
// ---------------------------------------------------------------------------

const setQuestionsSchema = z
  .object({
    // Exige a senha atual: sem isso, um token roubado poderia reescrever as
    // perguntas e criar uma porta permanente para a conta.
    currentPassword: z.string().min(1, 'Informe sua senha atual'),
    question1: z.enum(SECURITY_QUESTION_KEYS as [string, ...string[]]),
    answer1: z.string().min(2, 'Responda a primeira pergunta').trim(),
    question2: z.enum(SECURITY_QUESTION_KEYS as [string, ...string[]]),
    answer2: z.string().min(2, 'Responda a segunda pergunta').trim(),
  })
  .refine((d) => d.question1 !== d.question2, {
    message: 'Escolha duas perguntas diferentes',
    path: ['question2'],
  })

router.post(
  '/security-questions',
  authenticate,
  validate({ body: setQuestionsSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const body = req.body as z.infer<typeof setQuestionsSchema>

    const user = await prisma.user.findUnique({ where: { id: auth.userId } })
    if (!user) throw notFound('Usuário não encontrado')

    const valid = await bcrypt.compare(body.currentPassword, user.password)
    if (!valid) throw unauthorized('Senha incorreta')

    await prisma.user.update({
      where: { id: user.id },
      data: {
        securityQuestion1: body.question1,
        securityQuestion2: body.question2,
        securityAnswer1Hash: await bcrypt.hash(normalizeAnswer(body.answer1), 10),
        securityAnswer2Hash: await bcrypt.hash(normalizeAnswer(body.answer2), 10),
      },
    })

    return ok(res, { saved: true })
  }),
)

// ---------------------------------------------------------------------------
// POST /api/auth/change-password
// ---------------------------------------------------------------------------

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Informe a senha atual'),
  newPassword: z.string().min(6, 'A nova senha deve ter ao menos 6 caracteres'),
})

router.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>

    const user = await prisma.user.findUnique({ where: { id: auth.userId } })
    if (!user) throw notFound('Usuario nao encontrado')

    const valid = await bcrypt.compare(currentPassword, user.password)
    if (!valid) throw unauthorized('Senha atual incorreta')

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(newPassword, 10) },
    })

    return ok(res, { changed: true })
  }),
)

// ---------------------------------------------------------------------------
// GET /api/auth/status — diagnostico manual do ambiente.
// (Citava um `pnpm doctor` que nunca existiu como script.)
// ---------------------------------------------------------------------------

router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const tenants = await prisma.tenant.count()
    const users = await prisma.user.count()
    return ok(res, { api: 'online', tenants, users })
  }),
)

export default router
