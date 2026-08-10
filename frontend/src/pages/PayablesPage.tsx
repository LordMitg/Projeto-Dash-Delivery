/**
 * Contas a pagar — vencimentos, baixa e visao do que aperta o caixa.
 *
 * O backend (`/api/payables`) e a geracao automatica de conta a partir do XML
 * da nota ja existiam; faltava a tela. Sem ela o dono via a receita no DRE e
 * nenhuma das despesas que a importacao de notas vinha criando.
 *
 * Decisoes que valem registro:
 *
 * 1. **O status nunca e escolhido aqui.** `pending`, `partial`, `paid` e
 *    `overdue` sao derivados no servidor a partir de valor pago x total x
 *    vencimento. A tela apenas exibe. Um seletor de status permitiria "quitar"
 *    uma conta sem lancar um centavo.
 *
 * 2. **Baixa em dinheiro avisa antes.** Pagar em espécie exige caixa aberto
 *    (o valor sai da gaveta e vira despesa no turno). A tela diz isso ao lado
 *    da opcao, em vez de deixar o operador descobrir pelo erro do servidor.
 *
 * 3. **Os totais vem do servidor, sobre TUDO em aberto.** Somar apenas as linhas
 *    visiveis daria um "total a pagar" que muda conforme o filtro — o numero
 *    mais perigoso possivel numa tela de contas.
 */

import { useState } from 'react'
import useSWR from 'swr'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Plus,
  Search,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'

import { apiDelete, apiPost, errorMessage, swrFetcher } from '../lib/api'
import { useAuth } from '../context/AuthContext'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type PayableStatus = 'pending' | 'partial' | 'paid' | 'overdue'

interface Payable {
  id: string
  description: string
  supplierName: string
  supplierDoc: string | null
  amount: string
  amountPaid: string
  dueDate: string
  paidAt: string | null
  invoiceNumber: string | null
  notes: string | null
  status: PayableStatus
  /** Saldo devedor calculado no servidor. */
  remaining: number
  /** Negativo = dias em atraso. */
  daysUntilDue: number
  dreCategory?: { id: string; name: string } | null
}

interface PayableTotals {
  openCount: number
  openAmount: number
  overdueCount: number
  overdueAmount: number
  dueThisWeek: number
}

interface PayableList {
  items: Payable[]
  totals: PayableTotals
}

type PayMethod = 'pix' | 'cash' | 'credit' | 'debit' | 'transfer' | 'boleto'

// ─── Rotulos e formatadores ───────────────────────────────────────────────────

const STATUS_FILTERS: { value: 'all' | PayableStatus; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'overdue', label: 'Vencidas' },
  { value: 'pending', label: 'Em aberto' },
  { value: 'partial', label: 'Parciais' },
  { value: 'paid', label: 'Pagas' },
]

const STATUS_STYLE: Record<PayableStatus, { label: string; className: string }> = {
  pending: { label: 'Em aberto', className: 'border-line bg-canvas text-slate' },
  partial: { label: 'Parcial', className: 'border-warn/30 bg-warn-soft text-warn' },
  paid: { label: 'Paga', className: 'border-good/30 bg-good-soft text-good' },
  overdue: { label: 'Vencida', className: 'border-bad/30 bg-bad-soft text-bad' },
}

const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: 'pix', label: 'Pix' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'debit', label: 'Débito' },
  { value: 'credit', label: 'Crédito' },
  { value: 'cash', label: 'Dinheiro' },
]

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

/** Frase de vencimento em linguagem de gente, a partir de `daysUntilDue`. */
function dueLabel(days: number, status: PayableStatus) {
  if (status === 'paid') return 'Quitada'
  if (days < 0) return `${Math.abs(days)} dia${Math.abs(days) === 1 ? '' : 's'} em atraso`
  if (days === 0) return 'Vence hoje'
  if (days === 1) return 'Vence amanhã'
  return `Vence em ${days} dias`
}

const toNumber = (raw: string) => {
  const parsed = Number(raw.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

/** Data de hoje em `yyyy-mm-dd`, para pre-preencher o campo de vencimento. */
function todayInput() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ─── Blocos ───────────────────────────────────────────────────────────────────

function Feedback({ kind, text }: { kind: 'ok' | 'bad'; text: string }) {
  return (
    <p
      role="alert"
      className={`rounded-md border px-3 py-2 text-sm ${
        kind === 'ok'
          ? 'border-good/30 bg-good-soft text-good'
          : 'border-bad/30 bg-bad-soft text-bad'
      }`}
    >
      {text}
    </p>
  )
}

function TotalsRow({ totals }: { totals: PayableTotals }) {
  const cards = [
    {
      label: 'Total em aberto',
      value: brl(totals.openAmount),
      hint: `${totals.openCount} conta${totals.openCount === 1 ? '' : 's'}`,
      tone: 'text-ink',
    },
    {
      label: 'Vencidas',
      value: brl(totals.overdueAmount),
      hint: `${totals.overdueCount} conta${totals.overdueCount === 1 ? '' : 's'} em atraso`,
      tone: totals.overdueAmount > 0 ? 'text-bad' : 'text-ink',
    },
    {
      label: 'Vence em 7 dias',
      value: brl(totals.dueThisWeek),
      hint: 'Precisa de caixa nesta semana',
      tone: totals.dueThisWeek > 0 ? 'text-warn' : 'text-ink',
    },
  ]

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate">{c.label}</p>
          <p className={`text-xl font-semibold ${c.tone}`}>{c.value}</p>
          <p className="text-xs text-slate">{c.hint}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Formulario de nova conta ─────────────────────────────────────────────────

function NewPayableForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => Promise<void>
  onCancel: () => void
}) {
  const [description, setDescription] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState(todayInput())
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  async function submit() {
    if (description.trim().length < 2) {
      setFeedback({ kind: 'bad', text: 'Descreva a conta.' })
      return
    }
    if (toNumber(amount) <= 0) {
      setFeedback({ kind: 'bad', text: 'Informe um valor maior que zero.' })
      return
    }
    if (!dueDate) {
      setFeedback({ kind: 'bad', text: 'Informe o vencimento.' })
      return
    }

    setBusy(true)
    setFeedback(null)
    try {
      await apiPost('/api/payables', {
        description: description.trim(),
        supplierName: supplierName.trim() || null,
        amount: toNumber(amount),
        // `T12:00` no meio do dia evita o fuso empurrar o vencimento para a
        // vespera quando o navegador esta em UTC-3 e a data vai como meia-noite.
        dueDate: `${dueDate}T12:00:00`,
        invoiceNumber: invoiceNumber.trim() || null,
      })
      await onCreated()
      onCancel()
    } catch (err) {
      setFeedback({ kind: 'bad', text: errorMessage(err, 'Não foi possível lançar a conta.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="new-payable-title"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id="new-payable-title" className="text-sm font-semibold text-ink">
          Nova conta a pagar
        </h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Fechar formulário"
          className="text-slate transition-colors hover:text-ink"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {feedback && <Feedback {...feedback} />}

      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <label htmlFor="p-description" className="text-xs font-medium uppercase tracking-wide text-slate">
            Descrição
          </label>
          <input
            id="p-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Aluguel de janeiro"
            className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink"
          />
        </div>

        <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <label htmlFor="p-supplier" className="text-xs font-medium uppercase tracking-wide text-slate">
            Fornecedor <span className="normal-case">(opcional)</span>
          </label>
          <input
            id="p-supplier"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            placeholder="Distribuidora Silva"
            className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-36 flex-col gap-1">
          <label htmlFor="p-amount" className="text-xs font-medium uppercase tracking-wide text-slate">
            Valor
          </label>
          <div className="flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-2">
            <span aria-hidden="true" className="text-xs text-slate">
              R$
            </span>
            <input
              id="p-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              className="w-full bg-transparent text-sm text-ink outline-none"
            />
          </div>
        </div>

        <div className="flex w-44 flex-col gap-1">
          <label htmlFor="p-due" className="text-xs font-medium uppercase tracking-wide text-slate">
            Vencimento
          </label>
          <input
            id="p-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink"
          />
        </div>

        <div className="flex w-40 flex-col gap-1">
          <label htmlFor="p-invoice" className="text-xs font-medium uppercase tracking-wide text-slate">
            Nº da nota
          </label>
          <input
            id="p-invoice"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="000123"
            className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink"
          />
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="inline-flex h-[2.625rem] items-center justify-center gap-2 rounded-md bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
        >
          {busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
          Lançar conta
        </button>
      </div>
    </section>
  )
}

// ─── Baixa de pagamento ───────────────────────────────────────────────────────

function PayForm({
  payable,
  onPaid,
  onCancel,
}: {
  payable: Payable
  onPaid: () => Promise<void>
  onCancel: () => void
}) {
  const [amount, setAmount] = useState(String(payable.remaining))
  const [method, setMethod] = useState<PayMethod>('pix')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  const value = toNumber(amount)
  const partial = value > 0 && value < payable.remaining

  async function submit() {
    if (value <= 0) {
      setFeedback({ kind: 'bad', text: 'Informe um valor maior que zero.' })
      return
    }
    if (value > payable.remaining) {
      setFeedback({
        kind: 'bad',
        text: `Faltam apenas ${brl(payable.remaining)} nesta conta.`,
      })
      return
    }

    setBusy(true)
    setFeedback(null)
    try {
      await apiPost(`/api/payables/${payable.id}/pay`, { amount: value, paymentMethod: method })
      await onPaid()
      onCancel()
    } catch (err) {
      setFeedback({ kind: 'bad', text: errorMessage(err, 'Não foi possível dar baixa.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line bg-canvas px-4 py-4">
      {feedback && <Feedback {...feedback} />}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-36 flex-col gap-1">
          <label
            htmlFor={`pay-amount-${payable.id}`}
            className="text-xs font-medium uppercase tracking-wide text-slate"
          >
            Valor pago
          </label>
          <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-2">
            <span aria-hidden="true" className="text-xs text-slate">
              R$
            </span>
            <input
              id={`pay-amount-${payable.id}`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-transparent text-sm text-ink outline-none"
            />
          </div>
        </div>

        <div className="flex min-w-[10rem] flex-col gap-1">
          <label
            htmlFor={`pay-method-${payable.id}`}
            className="text-xs font-medium uppercase tracking-wide text-slate"
          >
            Forma
          </label>
          <select
            id={`pay-method-${payable.id}`}
            value={method}
            onChange={(e) => setMethod(e.target.value as PayMethod)}
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            {PAY_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="inline-flex h-[2.625rem] items-center justify-center gap-2 rounded-md bg-good px-4 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
          )}
          Confirmar baixa
        </button>

        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-[2.625rem] items-center justify-center rounded-md border border-line px-3 text-sm text-ink transition-colors hover:bg-surface"
        >
          Cancelar
        </button>
      </div>

      {method === 'cash' && (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-slate">
          <Wallet aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Pagamento em dinheiro sai da gaveta: é preciso ter o caixa aberto, e o valor
          entra como despesa do turno.
        </p>
      )}

      {partial && (
        <p className="text-xs leading-relaxed text-slate">
          Baixa parcial: restarão {brl(Math.round((payable.remaining - value) * 100) / 100)} nesta
          conta.
        </p>
      )}
    </div>
  )
}

// ─── Linha da lista ───────────────────────────────────────────────────────────

function PayableRow({
  payable,
  canManage,
  onChanged,
}: {
  payable: Payable
  canManage: boolean
  onChanged: () => Promise<void>
}) {
  const [paying, setPaying] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  const badge = STATUS_STYLE[payable.status]
  const paid = payable.status === 'paid'

  async function remove() {
    setRemoving(true)
    setRowError(null)
    try {
      await apiDelete(`/api/payables/${payable.id}`)
      await onChanged()
    } catch (err) {
      setRowError(errorMessage(err, 'Não foi possível excluir.'))
      setRemoving(false)
    }
  }

  return (
    <li className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <div className="min-w-[13rem] flex-1">
          <p className="truncate text-sm font-medium text-ink">{payable.description}</p>
          <p className="truncate text-xs text-slate">
            {payable.supplierName}
            {payable.invoiceNumber ? ` · NF ${payable.invoiceNumber}` : ''}
            {payable.dreCategory ? ` · ${payable.dreCategory.name}` : ''}
          </p>
        </div>

        <div className="w-32">
          <p className="text-sm text-ink">{shortDate(payable.dueDate)}</p>
          <p
            className={`text-xs ${
              payable.status === 'overdue' ? 'font-medium text-bad' : 'text-slate'
            }`}
          >
            {dueLabel(payable.daysUntilDue, payable.status)}
          </p>
        </div>

        <div className="w-28 text-right">
          <p className="text-sm font-semibold text-ink">
            {brl(Number(payable.amount))}
          </p>
          {Number(payable.amountPaid) > 0 && !paid && (
            <p className="text-xs text-slate">
              falta {brl(payable.remaining)}
            </p>
          )}
        </div>

        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>

        {canManage && !paid && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaying((v) => !v)}
              aria-expanded={paying}
              className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-good/40 hover:bg-good-soft hover:text-good"
            >
              {paying ? 'Fechar' : 'Dar baixa'}
            </button>

            {Number(payable.amountPaid) === 0 && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={removing}
                aria-label={`Excluir ${payable.description}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-slate transition-colors hover:border-bad/40 hover:text-bad disabled:opacity-60"
              >
                {removing ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {rowError && (
        <p role="alert" className="px-4 pb-3 text-xs text-bad">
          {rowError}
        </p>
      )}

      {paying && (
        <PayForm payable={payable} onPaid={onChanged} onCancel={() => setPaying(false)} />
      )}
    </li>
  )
}

// ─── Tela ─────────────────────────────────────────────────────────────────────

export function PayablesPage() {
  const { can } = useAuth()
  const canManage = can('payables:manage')

  const [status, setStatus] = useState<'all' | PayableStatus>('all')
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  const query = new URLSearchParams({ status, limit: '150' })
  if (search.trim()) query.set('search', search.trim())

  const { data, error, isLoading, mutate } = useSWR<PayableList>(
    `/api/payables?${query.toString()}`,
    swrFetcher,
    { keepPreviousData: true },
  )

  const reload = async () => {
    await mutate()
  }

  const items = data?.items ?? []
  const totals = data?.totals

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-ink">Contas a pagar</h2>
          <p className="text-sm leading-relaxed text-slate">
            Notas importadas por XML entram aqui automaticamente. Contas fixas você lança
            à mão.
          </p>
        </div>

        {canManage && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Nova conta
          </button>
        )}
      </header>

      {totals && <TotalsRow totals={totals} />}

      {totals && totals.overdueCount > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          {totals.overdueCount} conta{totals.overdueCount === 1 ? '' : 's'} vencida
          {totals.overdueCount === 1 ? '' : 's'}, somando {brl(totals.overdueAmount)}.
        </p>
      )}

      {creating && (
        <NewPayableForm onCreated={reload} onCancel={() => setCreating(false)} />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Filtrar por situação"
          className="flex flex-wrap gap-1.5"
        >
          {STATUS_FILTERS.map((f) => {
            const active = f.value === status
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={active}
                onClick={() => setStatus(f.value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-ink bg-ink text-white'
                    : 'border-line bg-surface text-ink hover:border-ink/30'
                }`}
              >
                {f.label}
              </button>
            )
          })}
        </div>

        <div className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-slate" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por descrição, fornecedor ou nota"
            aria-label="Buscar contas a pagar"
            className="w-full bg-transparent text-sm text-ink outline-none"
          />
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad"
        >
          {errorMessage(error, 'Não foi possível carregar as contas a pagar.')}
        </p>
      ) : isLoading && !data ? (
        <p className="flex items-center gap-2 py-10 text-sm text-slate">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Carregando contas...
        </p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-line px-6 py-14 text-center">
          <CalendarClock aria-hidden="true" className="h-6 w-6 text-slate" />
          <p className="text-sm font-medium text-ink">Nenhuma conta nesta situação</p>
          <p className="max-w-sm text-sm leading-relaxed text-slate">
            Importe uma nota fiscal para gerar a conta do fornecedor automaticamente, ou
            lance uma conta fixa como aluguel e energia.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {items.map((p) => (
            <PayableRow key={p.id} payable={p} canManage={canManage} onChanged={reload} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default PayablesPage
