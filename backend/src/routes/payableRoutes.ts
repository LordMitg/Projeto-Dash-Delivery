/**
 * Contas a pagar.
 *
 * Existia como tabela desde o inicio, sem nenhuma rota: as notas importadas por
 * XML nao geravam obrigacao de pagamento, e o dono nao tinha onde ver o que
 * vencia. Sem isto o DRE mostra receita sem a despesa correspondente.
 *
 * Duas decisoes que valem registro:
 *
 * 1. `status` NAO e escrito pelo cliente. E derivado de `amountPaid` x `amount`
 *    x `dueDate`. Deixar o cliente enviar "paid" permitiria quitar uma conta sem
 *    lancar um centavo.
 *
 * 2. "Vencido" e calculado na leitura, nao gravado. Uma conta vence sozinha com
 *    a passagem do tempo; se dependesse de alguem gravar o status, toda conta
 *    ficaria "pendente" para sempre — nao existe processo agendado aqui.
 */

import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import {
  asyncHandler,
  ok,
  createdResponse,
  noContent,
  notFound,
  badRequest,
  forbidden,
  conflict,
  requireAuth,
  serialize,
} from '../lib/http.js'
import { validate, z, idParam, money } from '../lib/validate.js'
import { hasPermission, type Permission } from '../lib/permissions.js'
import { findOpenRegister } from '../services/cashService.js'

const router = Router()

const dec = (v: number) => new Prisma.Decimal(v.toFixed(2))
const num = (v: Prisma.Decimal | null | undefined) => (v == null ? 0 : Number(v))
const round = (v: number) => Math.round(v * 100) / 100

function assertCan(req: Parameters<typeof requireAuth>[0], required: Permission) {
  const auth = requireAuth(req)
  if (!hasPermission(auth.role, auth.permissions, required)) {
    throw forbidden('Voce nao tem permissao para alterar contas a pagar.')
  }
  return auth
}

/** Comeco do dia de hoje: a conta so vence DEPOIS de terminar o dia do vencimento. */
function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Meia-noite do dia do vencimento.
 *
 * Vencimento e uma DATA, mas e gravado como timestamp ancorado ao meio-dia
 * (12:00) para nao mudar de dia ao cruzar fusos. Comparar esse meio-dia direto
 * com a meia-noite de hoje deixa meio dia de sobra na conta — e era exatamente
 * isso que quebrava o `daysUntilDue`. Zerando a hora dos dois lados a subtracao
 * volta a ser uma diferenca de dias de calendario.
 */
function startOfDueDay(dueDate: Date) {
  const d = new Date(dueDate)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Status efetivo, derivado dos valores.
 *
 * Uma conta parcialmente paga e vencida continua sendo um problema de caixa,
 * entao `overdue` tem prioridade sobre `partial` na exibicao.
 */
function effectiveStatus(row: { amount: Prisma.Decimal; amountPaid: Prisma.Decimal; dueDate: Date }) {
  const total = num(row.amount)
  const paid = num(row.amountPaid)
  if (paid >= total) return 'paid'
  if (row.dueDate < startOfToday()) return 'overdue'
  return paid > 0 ? 'partial' : 'pending'
}

/** Acrescenta os campos calculados que a tela consome. */
function decorate<T extends { amount: Prisma.Decimal; amountPaid: Prisma.Decimal; dueDate: Date }>(
  row: T,
) {
  const status = effectiveStatus(row)
  const remaining = round(Math.max(0, num(row.amount) - num(row.amountPaid)))
  // `Math.round` sobre dois horarios ja zerados: a divisao daria 0,99 ou 1,01
  // na virada do horario de verao, e arredondar corrige isso. O que NAO pode e
  // arredondar a meia diaria do meio-dia — com `dueDate` cru, uma conta que
  // vence hoje caia em 0,5 e virava 1 ("vence amanha"), e uma conta com um dia
  // de atraso caia em -0,5 e virava 0 ("vence hoje"), escondendo o atraso.
  const days = Math.round(
    (startOfDueDay(row.dueDate).getTime() - startOfToday().getTime()) / 86_400_000,
  )
  return {
    ...row,
    status,
    remaining,
    /** Negativo = dias em atraso. Poupa a tela de recalcular fuso horario. */
    daysUntilDue: days,
  }
}

// ---------------------------------------------------------------------------
// GET /api/payables — lista com filtros e totais
// ---------------------------------------------------------------------------
const listQuery = z.object({
  status: z.enum(['all', 'pending', 'partial', 'paid', 'overdue']).default('all'),
  search: z.string().trim().max(120).optional(),
  /** Vencimento dentro dos proximos N dias (para o alerta da tela). */
  dueInDays: z.coerce.number().int().min(0).max(365).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const q = req.query as unknown as z.infer<typeof listQuery>

    const where: Prisma.AccountPayableWhereInput = { tenantId: auth.tenantId }

    if (q.search) {
      where.OR = [
        { description: { contains: q.search, mode: 'insensitive' } },
        { supplierName: { contains: q.search, mode: 'insensitive' } },
        { invoiceNumber: { contains: q.search, mode: 'insensitive' } },
      ]
    }

    if (q.dueInDays != null) {
      const limitDate = new Date()
      limitDate.setDate(limitDate.getDate() + q.dueInDays)
      limitDate.setHours(23, 59, 59, 999)
      where.dueDate = { lte: limitDate }
    }

    // O filtro de status roda em memoria porque `status` e derivado (ver topo do
    // arquivo). O volume aqui e de contas em aberto de uma loja — dezenas, nao
    // milhares — entao vale a corretude em vez de duplicar a regra em SQL.
    const rows = await prisma.accountPayable.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }],
      take: q.limit,
      include: { dreCategory: { select: { id: true, name: true } } },
    })

    const decorated = rows.map(decorate)

    // O selo da linha mostra UM status so, e `overdue` ganha de `partial` (uma
    // conta atrasada e o problema mais urgente). Mas filtrar pelo selo esconderia
    // justamente a conta mais delicada: quem paga metade de um boleto atrasado
    // some da aba "Parciais", e o dono perde de vista que ainda deve o resto.
    // Por isso "Parciais" pergunta pelo fato (tem pagamento e ainda falta saldo),
    // nao pelo rotulo — a conta aparece nas duas abas, que e o esperado.
    const matchesStatus = (r: (typeof decorated)[number]) =>
      q.status === 'partial' ? num(r.amountPaid) > 0 && r.remaining > 0 : r.status === q.status

    const filtered = q.status === 'all' ? decorated : decorated.filter(matchesStatus)

    // Totais sobre TUDO que esta em aberto, nao apenas sobre a pagina filtrada:
    // e o numero que o dono usa para saber se o dinheiro do mes fecha.
    const openRows = decorated.filter((r) => r.status !== 'paid')
    const totals = {
      openCount: openRows.length,
      openAmount: round(openRows.reduce((s, r) => s + r.remaining, 0)),
      overdueCount: openRows.filter((r) => r.status === 'overdue').length,
      overdueAmount: round(
        openRows.filter((r) => r.status === 'overdue').reduce((s, r) => s + r.remaining, 0),
      ),
      dueThisWeek: round(
        openRows
          .filter((r) => r.daysUntilDue >= 0 && r.daysUntilDue <= 7)
          .reduce((s, r) => s + r.remaining, 0),
      ),
    }

    return ok(res, { items: filtered, totals })
  }),
)

// ---------------------------------------------------------------------------
// POST /api/payables — lancar conta
// ---------------------------------------------------------------------------
const createSchema = z.object({
  description: z.string().trim().min(2, 'Descreva a conta').max(200),
  // Opcional de proposito: aluguel, energia e imposto nao tem "fornecedor" no
  // sentido comum, e obrigar o campo levaria o operador a digitar lixo. A coluna
  // e NOT NULL no banco, entao cai num rotulo neutro quando vazia.
  supplierName: z.string().trim().max(160).nullish(),
  supplierDoc: z.string().trim().max(20).nullish(),
  amount: money.refine((v) => v > 0, 'O valor deve ser maior que zero'),
  dueDate: z.coerce.date(),
  invoiceNumber: z.string().trim().max(60).nullish(),
  dreCategoryId: z.string().trim().nullish(),
  notes: z.string().trim().max(500).nullish(),
})

router.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const auth = assertCan(req, 'payables:manage')
    const body = req.body as z.infer<typeof createSchema>

    // Categoria precisa ser da mesma loja: sem esta checagem uma conta poderia
    // apontar para a categoria de DRE de outro negocio e contaminar o relatorio.
    if (body.dreCategoryId) {
      const cat = await prisma.dreCategory.findFirst({
        where: { id: body.dreCategoryId, tenantId: auth.tenantId },
        select: { id: true },
      })
      if (!cat) throw badRequest('Categoria de DRE nao encontrada nesta loja')
    }

    const created = await prisma.accountPayable.create({
      data: {
        tenantId: auth.tenantId,
        description: body.description,
        supplierName: body.supplierName?.trim() || 'Nao informado',
        supplierDoc: body.supplierDoc ?? null,
        amount: dec(body.amount),
        dueDate: body.dueDate,
        invoiceNumber: body.invoiceNumber ?? null,
        dreCategoryId: body.dreCategoryId ?? null,
        notes: body.notes ?? null,
      },
      include: { dreCategory: { select: { id: true, name: true } } },
    })

    return createdResponse(res, decorate(created))
  }),
)

// ---------------------------------------------------------------------------
// PATCH /api/payables/:id — editar conta em aberto
// ---------------------------------------------------------------------------
const updateSchema = createSchema.partial()

router.patch(
  '/:id',
  validate({ params: idParam, body: updateSchema }),
  asyncHandler(async (req, res) => {
    const auth = assertCan(req, 'payables:manage')
    const { id } = req.params as { id: string }
    const body = req.body as z.infer<typeof updateSchema>

    const existing = await prisma.accountPayable.findFirst({
      where: { id, tenantId: auth.tenantId },
    })
    if (!existing) throw notFound('Conta nao encontrada nesta loja')

    // Conta quitada nao se edita: mudar o valor de algo ja pago reescreveria a
    // despesa que ja entrou no DRE do mes fechado.
    if (num(existing.amountPaid) >= num(existing.amount)) {
      throw conflict('Esta conta ja foi paga e nao pode mais ser editada.', 'PAYABLE_PAID')
    }

    // Novo valor nao pode ser menor do que o ja pago, senao o saldo fica negativo.
    if (body.amount != null && body.amount < num(existing.amountPaid)) {
      throw badRequest(
        `Ja foram pagos R$ ${num(existing.amountPaid).toFixed(2)} desta conta. ` +
          `O valor total nao pode ser menor que isso.`,
      )
    }

    const updated = await prisma.accountPayable.update({
      where: { id },
      data: {
        description: body.description,
        // `?? undefined` e proposital: `undefined` faz o Prisma NAO tocar na
        // coluna, enquanto `null` tentaria gravar nulo numa coluna NOT NULL.
        supplierName: body.supplierName?.trim() || undefined,
        supplierDoc: body.supplierDoc,
        amount: body.amount != null ? dec(body.amount) : undefined,
        dueDate: body.dueDate,
        invoiceNumber: body.invoiceNumber,
        dreCategoryId: body.dreCategoryId,
        notes: body.notes,
      },
      include: { dreCategory: { select: { id: true, name: true } } },
    })

    return ok(res, decorate(updated))
  }),
)

// ---------------------------------------------------------------------------
// POST /api/payables/:id/pay — dar baixa (total ou parcial)
// ---------------------------------------------------------------------------
const paySchema = z.object({
  amount: money.refine((v) => v > 0, 'O valor deve ser maior que zero'),
  /**
   * Quando `cash`, a baixa tambem sai da gaveta do caixa aberto — e o unico
   * jeito de o fechamento bater quando o dono paga o hortifruti em especie.
   */
  paymentMethod: z.enum(['cash', 'credit', 'debit', 'pix', 'transfer', 'boleto']).default('pix'),
  notes: z.string().trim().max(300).nullish(),
})

router.post(
  '/:id/pay',
  validate({ params: idParam, body: paySchema }),
  asyncHandler(async (req, res) => {
    const auth = assertCan(req, 'payables:manage')
    const { id } = req.params as { id: string }
    const body = req.body as z.infer<typeof paySchema>

    const account = await prisma.accountPayable.findFirst({
      where: { id, tenantId: auth.tenantId },
    })
    if (!account) throw notFound('Conta nao encontrada nesta loja')

    const remaining = round(num(account.amount) - num(account.amountPaid))
    if (remaining <= 0) throw conflict('Esta conta ja esta quitada.', 'PAYABLE_PAID')

    // Impede pagar mais do que se deve: o excedente viraria credito invisivel,
    // sem nenhuma tela onde aparecer.
    if (body.amount > remaining) {
      throw badRequest(
        `Faltam R$ ${remaining.toFixed(2)} nesta conta. ` +
          `Nao e possivel dar baixa de R$ ${body.amount.toFixed(2)}.`,
      )
    }

    // Pagamento em especie exige caixa aberto: e de lá que o dinheiro sai.
    let registerId: string | null = null
    if (body.paymentMethod === 'cash') {
      const register = await findOpenRegister(prisma, auth.tenantId)
      if (!register) {
        throw conflict(
          'Para pagar em dinheiro e preciso ter o caixa aberto, porque o valor sai da gaveta.',
          'CASH_CLOSED',
        )
      }
      registerId = register.id
    }

    const newPaid = round(num(account.amountPaid) + body.amount)
    const fullyPaid = newPaid >= num(account.amount)

    // Transacao: a baixa e a saida de caixa precisam existir juntas, senao o
    // dinheiro sai da gaveta sem a conta baixar (ou o contrario).
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.accountPayable.update({
        where: { id },
        data: {
          amountPaid: dec(newPaid),
          paidAt: fullyPaid ? new Date() : null,
          status: fullyPaid ? 'paid' : 'partial',
          notes: body.notes ? [account.notes, body.notes].filter(Boolean).join('\n') : undefined,
        },
        include: { dreCategory: { select: { id: true, name: true } } },
      })

      if (registerId) {
        await tx.cashEntry.create({
          data: {
            cashRegisterId: registerId,
            type: 'expense',
            amount: dec(body.amount),
            description: `${account.supplierName} — ${account.description}`,
            paymentMethod: 'cash',
            referenceType: 'payable',
            referenceId: account.id,
            createdById: auth.userId,
          },
        })
      }

      return updated
    })

    return ok(res, decorate(result))
  }),
)

// ---------------------------------------------------------------------------
// DELETE /api/payables/:id — excluir conta ainda nao paga
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const auth = assertCan(req, 'payables:manage')
    const { id } = req.params as { id: string }

    const account = await prisma.accountPayable.findFirst({
      where: { id, tenantId: auth.tenantId },
      select: { id: true, amountPaid: true },
    })
    if (!account) throw notFound('Conta nao encontrada nesta loja')

    // Apagar uma conta com pagamento lancado apagaria a saida de caixa junto:
    // a gaveta ficaria com uma despesa sem origem.
    if (num(account.amountPaid) > 0) {
      throw conflict(
        'Esta conta ja tem pagamento lancado e nao pode ser excluida.',
        'PAYABLE_HAS_PAYMENT',
      )
    }

    await prisma.accountPayable.delete({ where: { id } })
    return noContent(res)
  }),
)

export default router
