/**
 * Caixa — abertura, movimentos e fechamento com conferencia.
 *
 * O PDV depende destas rotas para poder vender: sem turno aberto a venda e
 * recusada (regra escolhida pelo dono do negocio). Antes o modulo existia
 * apenas como tabela no banco, sem nenhuma rota — a tela de Financeiro chamava
 * `/api/financial/cash` e recebia 404.
 *
 * Separacao de permissoes proposital:
 *  - `cash:operate` abre o turno e lanca suprimento (entra dinheiro).
 *  - `cash:close`   faz sangria e fecha o turno (sai dinheiro / responde pela
 *                   diferenca).
 * Quem so opera nao deveria poder retirar dinheiro nem "acertar" o fechamento.
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
  badRequest,
  forbidden,
  requireAuth,
  serialize,
} from '../lib/http.js'
import { validate, z, idParam, money } from '../lib/validate.js'
import { hasPermission, type Permission } from '../lib/permissions.js'
import {
  buildCashSummary,
  findOpenRegister,
  CASH_ENTRY_TYPES,
  PAYMENT_METHODS,
  ENTRY_LABELS,
} from '../services/cashService.js'
import { emitToTenant } from '../lib/realtime.js'

const router = Router()

const dec = (v: number) => new Prisma.Decimal(v.toFixed(2))

/**
 * Guard local.
 *
 * O mount em `index.ts` exige apenas a permissao de LEITURA; cada verbo que
 * mexe em dinheiro exige a sua aqui dentro. Assim um garcom consegue ver se o
 * caixa esta aberto (o PDV precisa saber) sem poder fazer sangria.
 */
function assertCan(req: Parameters<typeof requireAuth>[0], required: Permission) {
  const auth = requireAuth(req)
  if (!hasPermission(auth.role, auth.permissions, required)) {
    throw forbidden('Voce nao tem permissao para esta acao no caixa.')
  }
  return auth
}

/** Nome legivel de quem abriu/fechou, para a tela nao mostrar um cuid. */
const userSelect = { select: { id: true, firstName: true, lastName: true } }

// ---------------------------------------------------------------------------
// GET /api/cash/current — turno aberto (ou null) com o resumo ao vivo
// ---------------------------------------------------------------------------
// O PDV chama isto ao abrir: e o que decide se a venda pode ser lancada.
router.get(
  '/current',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)

    const register = await findOpenRegister(prisma, auth.tenantId)
    if (!register) return ok(res, { register: null, summary: null })

    const [full, summary] = await Promise.all([
      prisma.cashRegister.findUnique({
        where: { id: register.id },
        include: { openedBy: userSelect },
      }),
      buildCashSummary(prisma, register.id),
    ])

    return ok(res, { register: full, summary })
  }),
)

// ---------------------------------------------------------------------------
// POST /api/cash/open — abrir turno
// ---------------------------------------------------------------------------
const openSchema = z.object({
  /** Troco inicial colocado na gaveta. */
  openingBalance: money.default(0),
  notes: z.string().trim().max(500).nullish(),
})

router.post(
  '/open',
  validate({ body: openSchema }),
  asyncHandler(async (req, res) => {
    const auth = assertCan(req, 'cash:operate')
    const body = req.body as z.infer<typeof openSchema>

    // Uma loja, um turno aberto. Com dois turnos abertos as vendas se dividiriam
    // entre eles de forma imprevisivel e nenhum fecharia corretamente.
    const existing = await findOpenRegister(prisma, auth.tenantId)
    if (existing) {
      throw conflict(
        'Ja existe um caixa aberto nesta loja. Feche o turno atual antes de abrir outro.',
        'CASH_ALREADY_OPEN',
      )
    }

    const register = await prisma.cashRegister.create({
      data: {
        tenantId: auth.tenantId,
        openedById: auth.userId,
        openingBalance: dec(body.openingBalance),
        status: 'open',
        notes: body.notes ?? null,
      },
      include: { openedBy: userSelect },
    })

    emitToTenant(auth.tenantId, 'cash:opened', serialize(register))
    return createdResponse(res, register)
  }),
)

// ---------------------------------------------------------------------------
// POST /api/cash/entries — suprimento, sangria, despesa ou estorno
// ---------------------------------------------------------------------------
const entrySchema = z.object({
  // `sale` fica de fora: venda e criada pelo PDV junto com o pedido, dentro da
  // mesma transacao. Permitir lancar "venda" a mao aqui criaria faturamento sem
  // pedido nenhum atras — e o relatorio nunca mais fecharia com a operacao.
  type: z.enum(['supply', 'withdrawal', 'expense', 'refund']),
  amount: money.refine((v) => v > 0, 'O valor deve ser maior que zero'),
  description: z.string().trim().min(3, 'Descreva o motivo em pelo menos 3 caracteres').max(200),
})

router.post(
  '/entries',
  validate({ body: entrySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof entrySchema>

    // Suprimento aumenta a gaveta: quem opera pode. Sangria, despesa e estorno
    // TIRAM dinheiro, entao exigem a permissao de fechamento.
    const auth = assertCan(req, body.type === 'supply' ? 'cash:operate' : 'cash:close')

    const register = await findOpenRegister(prisma, auth.tenantId)
    if (!register) {
      throw conflict(
        'Nenhum caixa aberto. Abra o caixa antes de lancar movimentos.',
        'CASH_CLOSED',
      )
    }

    // Nao deixa a gaveta ficar negativa: seria impossivel na vida real, e o
    // fechamento passaria a acusar uma falta que na verdade e erro de digitacao.
    if (body.type !== 'supply') {
      const summary = await buildCashSummary(prisma, register.id)
      if (body.amount > summary.expectedCash) {
        throw badRequest(
          `Ha apenas R$ ${summary.expectedCash.toFixed(2)} em dinheiro no caixa. ` +
            `Nao e possivel lancar ${ENTRY_LABELS[body.type].toLowerCase()} de ` +
            `R$ ${body.amount.toFixed(2)}.`,
        )
      }
    }

    const entry = await prisma.cashEntry.create({
      data: {
        cashRegisterId: register.id,
        type: body.type,
        amount: dec(body.amount),
        description: body.description,
        paymentMethod: 'cash',
        referenceType: 'manual',
        createdById: auth.userId,
      },
      include: { createdBy: userSelect },
    })

    const summary = await buildCashSummary(prisma, register.id)
    emitToTenant(auth.tenantId, 'cash:entry', serialize({ entry, summary }))

    return createdResponse(res, { entry, summary })
  }),
)

// ---------------------------------------------------------------------------
// GET /api/cash/:id/entries — extrato do turno
// ---------------------------------------------------------------------------
router.get(
  '/:id/entries',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const { id } = req.params as { id: string }

    // Confere o tenant ANTES de devolver: sem isso um id de outra loja
    // retornaria o extrato dela.
    const register = await prisma.cashRegister.findFirst({
      where: { id, tenantId: auth.tenantId },
      select: { id: true },
    })
    if (!register) throw notFound('Caixa nao encontrado nesta loja')

    const entries = await prisma.cashEntry.findMany({
      where: { cashRegisterId: id },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: userSelect },
    })

    return ok(res, entries)
  }),
)

// ---------------------------------------------------------------------------
// GET /api/cash/:id/summary — resumo (usado tambem na conferencia)
// ---------------------------------------------------------------------------
router.get(
  '/:id/summary',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const { id } = req.params as { id: string }

    const register = await prisma.cashRegister.findFirst({
      where: { id, tenantId: auth.tenantId },
      select: { id: true },
    })
    if (!register) throw notFound('Caixa nao encontrado nesta loja')

    return ok(res, await buildCashSummary(prisma, id))
  }),
)

// ---------------------------------------------------------------------------
// POST /api/cash/:id/close — fechar com conferencia
// ---------------------------------------------------------------------------
const closeSchema = z.object({
  /** Valor em especie efetivamente contado na gaveta. */
  countedCash: money,
  notes: z.string().trim().max(500).nullish(),
})

router.post(
  '/:id/close',
  validate({ params: idParam, body: closeSchema }),
  asyncHandler(async (req, res) => {
    const auth = assertCan(req, 'cash:close')
    const { id } = req.params as { id: string }
    const body = req.body as z.infer<typeof closeSchema>

    const register = await prisma.cashRegister.findFirst({
      where: { id, tenantId: auth.tenantId },
    })
    if (!register) throw notFound('Caixa nao encontrado nesta loja')
    if (register.status !== 'open') {
      throw conflict('Este caixa ja esta fechado.', 'CASH_ALREADY_CLOSED')
    }

    // O esperado e calculado no servidor, no momento do fechamento: se viesse do
    // cliente, a diferenca (o unico numero que importa aqui) seria escolhida por
    // quem esta sendo conferido.
    const summary = await buildCashSummary(prisma, id)
    const difference = Math.round((body.countedCash - summary.expectedCash) * 100) / 100

    const closed = await prisma.cashRegister.update({
      where: { id },
      data: {
        status: 'closed',
        closedAt: new Date(),
        closedById: auth.userId,
        closingBalance: dec(body.countedCash),
        expectedBalance: dec(summary.expectedCash),
        difference: dec(difference),
        // Preserva a observacao da abertura e acrescenta a do fechamento.
        notes: [register.notes, body.notes].filter(Boolean).join('\n---\n') || null,
      },
      include: { openedBy: userSelect, closedBy: userSelect },
    })

    const payload = serialize({
      register: closed,
      summary: { ...summary, countedCash: body.countedCash, difference },
    })

    emitToTenant(auth.tenantId, 'cash:closed', payload)
    return ok(res, payload)
  }),
)

// ---------------------------------------------------------------------------
// GET /api/cash/history — turnos anteriores
// ---------------------------------------------------------------------------
const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

router.get(
  '/history',
  validate({ query: historyQuery }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const { limit } = req.query as unknown as z.infer<typeof historyQuery>

    const registers = await prisma.cashRegister.findMany({
      where: { tenantId: auth.tenantId, status: 'closed' },
      orderBy: { closedAt: 'desc' },
      take: limit,
      include: { openedBy: userSelect, closedBy: userSelect },
    })

    return ok(res, registers)
  }),
)

// ---------------------------------------------------------------------------
// GET /api/cash/meta — rotulos para a interface
// ---------------------------------------------------------------------------
router.get(
  '/meta',
  asyncHandler(async (_req, res) =>
    ok(res, {
      entryTypes: CASH_ENTRY_TYPES.map((t) => ({ value: t, label: ENTRY_LABELS[t] })),
      paymentMethods: PAYMENT_METHODS,
    }),
  ),
)

export default router
