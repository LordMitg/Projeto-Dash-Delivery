/**
 * Caixa (turno de operacao) — regras de dinheiro.
 *
 * Este arquivo concentra a conta do "quanto deveria ter na gaveta", porque ela
 * e usada em dois lugares que NAO podem divergir: o resumo que o operador ve
 * durante o turno e a conferencia no fechamento. Quando essa conta existia
 * duplicada, o resumo dizia um valor e o fechamento acusava outro.
 *
 * A regra central, e a mais facil de errar:
 *
 *   SO dinheiro em especie entra na conferencia da gaveta.
 *
 * Cartao, Pix e voucher aumentam o FATURAMENTO do turno, mas nao colocam uma
 * nota na gaveta. Somar tudo junto e o motivo classico de "o caixa fecha
 * sempre sobrando" — e do operador aprender a ignorar a diferenca, que era
 * justamente o unico sinal util do fechamento.
 *
 * Sobre troco: a parcela em dinheiro guarda `amount` (o que foi abatido do
 * pedido) e `changeFor` (a nota que o cliente entregou). O que fica na gaveta e
 * `amount`, nao `changeFor` — a diferenca volta para a mao do cliente. Por isso
 * o lancamento de venda registra `amount` e o troco nao vira saida separada.
 */

import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'

/** Aceita tanto o client normal quanto o de dentro de uma transacao. */
type Db = PrismaClient | Prisma.TransactionClient

/** Lancamentos que SOMAM na gaveta. */
const INFLOW_TYPES = ['sale', 'supply'] as const
/** Lancamentos que SUBTRAEM da gaveta. */
const OUTFLOW_TYPES = ['withdrawal', 'expense', 'refund'] as const

export type CashEntryType = (typeof INFLOW_TYPES)[number] | (typeof OUTFLOW_TYPES)[number]

export const CASH_ENTRY_TYPES: CashEntryType[] = [...INFLOW_TYPES, ...OUTFLOW_TYPES]

/** Formas de pagamento aceitas em um lancamento de caixa. */
export const PAYMENT_METHODS = ['cash', 'credit', 'debit', 'pix', 'voucher', 'fiado'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/** Rotulos em portugues, usados nas mensagens de erro e no resumo. */
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  credit: 'Crédito',
  debit: 'Débito',
  pix: 'PIX',
  voucher: 'Voucher',
  fiado: 'Fiado',
}

export const ENTRY_LABELS: Record<CashEntryType, string> = {
  sale: 'Venda',
  supply: 'Suprimento',
  withdrawal: 'Sangria',
  expense: 'Despesa',
  refund: 'Estorno',
}

const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v))
const round = (v: number) => Math.round(v * 100) / 100

export interface CashSummary {
  registerId: string
  status: string
  openedAt: Date
  closedAt: Date | null
  openingBalance: number
  /** Total vendido no turno, em TODAS as formas de pagamento. */
  totalSales: number
  /** Quantidade de vendas registradas no turno. */
  salesCount: number
  /** Quebra do faturamento por forma de pagamento. */
  byMethod: Record<string, { amount: number; count: number }>
  /** Movimentos manuais em especie. */
  supplies: number
  withdrawals: number
  expenses: number
  refunds: number
  /** Troco total devolvido (informativo: nao afeta a gaveta). */
  changeGiven: number
  /**
   * Quanto deve haver em ESPECIE na gaveta agora:
   * abertura + vendas em dinheiro + suprimentos - sangrias - despesas - estornos
   */
  expectedCash: number
  /** Valor contado pelo operador no fechamento (null enquanto aberto). */
  countedCash: number | null
  /** contado - esperado. Negativo = falta dinheiro. */
  difference: number | null
}

/**
 * Monta o resumo financeiro de um turno.
 *
 * Recalcula a partir dos lancamentos em vez de manter um saldo acumulado numa
 * coluna: um saldo incremental silenciosamente erra para sempre se uma unica
 * operacao falhar no meio, e ninguem descobre qual foi.
 */
export async function buildCashSummary(db: Db, registerId: string): Promise<CashSummary> {
  const register = await db.cashRegister.findUnique({
    where: { id: registerId },
    select: {
      id: true,
      status: true,
      openedAt: true,
      closedAt: true,
      openingBalance: true,
      closingBalance: true,
    },
  })
  if (!register) throw new Error(`Caixa ${registerId} nao encontrado`)

  const entries = await db.cashEntry.findMany({
    where: { cashRegisterId: registerId },
    select: { type: true, amount: true, paymentMethod: true },
  })

  const byMethod: Record<string, { amount: number; count: number }> = {}
  let totalSales = 0
  let salesCount = 0
  let cashSales = 0
  let supplies = 0
  let withdrawals = 0
  let expenses = 0
  let refunds = 0

  for (const e of entries) {
    const amount = num(e.amount)

    if (e.type === 'sale') {
      totalSales += amount
      salesCount += 1
      const slot = (byMethod[e.paymentMethod] ??= { amount: 0, count: 0 })
      slot.amount += amount
      slot.count += 1
      // Somente especie mexe na gaveta.
      if (e.paymentMethod === 'cash') cashSales += amount
      continue
    }

    // Movimentos manuais: por definicao sao de gaveta. Um "suprimento em Pix"
    // nao existe na operacao real, entao nao ha o que filtrar aqui.
    if (e.type === 'supply') supplies += amount
    else if (e.type === 'withdrawal') withdrawals += amount
    else if (e.type === 'expense') expenses += amount
    else if (e.type === 'refund') refunds += amount
  }

  for (const key of Object.keys(byMethod)) {
    byMethod[key]!.amount = round(byMethod[key]!.amount)
  }

  const openingBalance = num(register.openingBalance)
  const expectedCash = round(
    openingBalance + cashSales + supplies - withdrawals - expenses - refunds,
  )

  // Troco devolvido: informativo. Ja esta embutido no fato de a venda registrar
  // `amount` (liquido) e nao `changeFor` (a nota recebida).
  const changeAgg = await db.orderPayment.aggregate({
    where: { order: { cashRegisterId: registerId }, method: 'cash' },
    _sum: { changeAmount: true },
  })

  const countedCash = register.closingBalance == null ? null : num(register.closingBalance)

  return {
    registerId: register.id,
    status: register.status,
    openedAt: register.openedAt,
    closedAt: register.closedAt,
    openingBalance: round(openingBalance),
    totalSales: round(totalSales),
    salesCount,
    byMethod,
    supplies: round(supplies),
    withdrawals: round(withdrawals),
    expenses: round(expenses),
    refunds: round(refunds),
    changeGiven: round(num(changeAgg._sum.changeAmount)),
    expectedCash,
    countedCash,
    difference: countedCash == null ? null : round(countedCash - expectedCash),
  }
}

/**
 * Turno aberto da loja, ou `null`.
 *
 * Uma loja tem no maximo UM turno aberto por vez. Isso e garantido tambem na
 * abertura (que recusa abrir com outro em aberto): sem essa trava, duas vendas
 * simultaneas cairiam em turnos diferentes e nenhum dos dois fecharia.
 */
export async function findOpenRegister(db: Db, tenantId: string) {
  return db.cashRegister.findFirst({
    where: { tenantId, status: 'open' },
    orderBy: { openedAt: 'desc' },
  })
}

/**
 * Registra a venda no caixa: uma linha por forma de pagamento.
 *
 * Uma linha por forma, e nao uma pelo total, porque o fechamento precisa saber
 * quanto entrou em especie. Com uma linha unica de R$ 80 numa venda paga com
 * R$ 50 no cartao e R$ 30 em dinheiro, a gaveta seria cobrada por R$ 80.
 *
 * `fiado` nao gera lancamento: nao entrou dinheiro nenhum, virou contas a
 * receber. Lancar como venda faria a gaveta ficar devendo um valor que ninguem
 * pagou.
 */
export async function recordSaleInCash(
  db: Db,
  params: {
    registerId: string
    orderId: string
    orderNumber: string
    userId: string
    payments: Array<{ method: string; amount: number }>
  },
) {
  const billable = params.payments.filter((p) => p.method !== 'fiado' && p.amount > 0)
  if (billable.length === 0) return

  await db.cashEntry.createMany({
    data: billable.map((p) => ({
      cashRegisterId: params.registerId,
      type: 'sale',
      amount: new Prisma.Decimal(p.amount.toFixed(2)),
      description: `Venda #${params.orderNumber}`,
      paymentMethod: p.method,
      referenceType: 'order',
      referenceId: params.orderId,
      createdById: params.userId,
    })),
  })
}
