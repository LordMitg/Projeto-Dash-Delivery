/**
 * Caixa — abertura, movimentos e fechamento com conferencia.
 *
 * Esta tela era a metade que faltava do modulo: o backend (`/api/cash/*`) e o
 * hook `useCashRegister` ja existiam, o PDV ja bloqueava a venda sem turno
 * aberto e ja apontava um link para `/caixa` — mas a rota nao existia. O
 * operador via "O caixa esta fechado. Abrir o caixa" e o clique nao levava a
 * lugar nenhum.
 *
 * Tres decisoes que valem registro:
 *
 * 1. **O esperado na gaveta nunca e digitado.** O campo do fechamento pede o
 *    valor CONTADO; o esperado vem do servidor. Mostrar os dois lado a lado
 *    antes de contar induziria o operador a repetir o numero da tela, e a
 *    diferenca — o unico dado util da conferencia — seria sempre zero. Por isso
 *    o esperado so aparece DEPOIS de o valor contado ser informado.
 *
 * 2. **Suprimento e separado de sangria/despesa/estorno.** Sao permissoes
 *    diferentes no servidor (`cash:operate` x `cash:close`), entao a tela
 *    tambem as separa: um caixa que so opera nao ve o formulario de retirada em
 *    vez de ve-lo e tomar um 403 depois de preencher.
 *
 * 3. **Nada e recalculado aqui.** Todo total vem de `summary`, produzido por
 *    `buildCashSummary`. Recalcular no cliente foi exatamente o bug que aquele
 *    servico nasceu para eliminar: resumo e fechamento divergindo por
 *    arredondamento.
 */

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CalendarClock,
  Loader2,
  Lock,
  LockOpen,
  Receipt,
  RotateCcw,
  Wallet,
} from 'lucide-react'

import { errorMessage, swrFetcher } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import {
  useCashRegister,
  type CashEntryType,
  type CashRegisterRow,
} from '../hooks/useCashRegister'

// ─── Tipos locais ─────────────────────────────────────────────────────────────

interface CashEntryRow {
  id: string
  type: CashEntryType
  amount: string
  description: string
  paymentMethod: string
  referenceType: string | null
  createdAt: string
  createdBy?: { id: string; firstName: string; lastName: string } | null
}

/** Tipos que o operador lanca a mao. `sale` sai da lista: quem cria e o PDV. */
type ManualEntryType = Exclude<CashEntryType, 'sale'>

// ─── Rotulos e formatadores ───────────────────────────────────────────────────

const ENTRY_LABEL: Record<CashEntryType, string> = {
  sale: 'Venda',
  supply: 'Suprimento',
  withdrawal: 'Sangria',
  expense: 'Despesa',
  refund: 'Estorno',
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Dinheiro',
  credit: 'Crédito',
  debit: 'Débito',
  pix: 'Pix',
  voucher: 'Vale',
  fiado: 'Fiado',
}

/** Lancamentos que somam na gaveta — usado so para escolher a cor e a seta. */
const INFLOW: CashEntryType[] = ['sale', 'supply']

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

const personName = (p?: { firstName: string; lastName: string } | null) =>
  p ? `${p.firstName} ${p.lastName}`.trim() : 'Sistema'

/** Converte o campo digitado em numero, aceitando virgula decimal. */
const toNumber = (raw: string) => {
  const parsed = Number(raw.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

// ─── Blocos reutilizados ──────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'good' | 'bad' | 'brand'
}) {
  const valueTone =
    tone === 'good'
      ? 'text-good'
      : tone === 'bad'
        ? 'text-bad'
        : tone === 'brand'
          ? 'text-brand-strong'
          : 'text-ink'

  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate">{label}</p>
      <p className={`text-xl font-semibold ${valueTone}`}>{value}</p>
      {hint && <p className="text-xs leading-relaxed text-slate">{hint}</p>}
    </div>
  )
}

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

// ─── Abertura do turno ────────────────────────────────────────────────────────

function OpenCashCard({
  onOpen,
  canOpen,
}: {
  onOpen: (opening: number, notes: string) => Promise<void>
  canOpen: boolean
}) {
  const [opening, setOpening] = useState('0')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  async function submit() {
    setBusy(true)
    setFeedback(null)
    try {
      await onOpen(toNumber(opening), notes.trim())
    } catch (err) {
      setFeedback({ kind: 'bad', text: errorMessage(err, 'Não foi possível abrir o caixa.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="open-cash-title"
      className="flex max-w-xl flex-col gap-4 rounded-card border border-line bg-surface p-6"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-brand-strong"
        >
          <LockOpen className="h-5 w-5" />
        </span>
        <div className="flex flex-col">
          <h2 id="open-cash-title" className="text-lg font-semibold text-ink">
            Abrir o caixa
          </h2>
          <p className="text-sm text-slate">
            Enquanto o turno não estiver aberto, o PDV recusa qualquer venda.
          </p>
        </div>
      </div>

      {!canOpen ? (
        <p className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-ink">
          Seu acesso não permite abrir o caixa. Peça ao gerente ou ao dono do negócio.
        </p>
      ) : (
        <>
          {feedback && <Feedback {...feedback} />}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="opening-balance" className="text-sm font-medium text-ink">
              Troco inicial na gaveta
            </label>
            <div className="flex items-center gap-2 rounded-md border border-line bg-canvas px-3 py-2">
              <span aria-hidden="true" className="text-sm text-slate">
                R$
              </span>
              <input
                id="opening-balance"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                className="w-full bg-transparent text-base text-ink outline-none"
              />
            </div>
            <p className="text-xs leading-relaxed text-slate">
              Conte o dinheiro antes de digitar: esse valor é a base da conferência no
              fechamento.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="opening-notes" className="text-sm font-medium text-ink">
              Observação <span className="font-normal text-slate">(opcional)</span>
            </label>
            <input
              id="opening-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Turno da noite, gaveta 2"
              className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink"
            />
          </div>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 self-start rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <LockOpen aria-hidden="true" className="h-4 w-4" />
            )}
            {busy ? 'Abrindo...' : 'Abrir caixa'}
          </button>
        </>
      )}
    </section>
  )
}

// ─── Lancamento manual ────────────────────────────────────────────────────────

function EntryForm({
  canOperate,
  canClose,
  onSubmit,
}: {
  canOperate: boolean
  canClose: boolean
  onSubmit: (input: { type: ManualEntryType; amount: number; description: string }) => Promise<void>
}) {
  // Suprimento exige `cash:operate`; os demais TIRAM dinheiro e exigem
  // `cash:close`. A lista segue a mesma regra do servidor para o operador nunca
  // preencher um formulario que voltaria 403.
  const available = useMemo(() => {
    const list: ManualEntryType[] = []
    if (canOperate) list.push('supply')
    if (canClose) list.push('withdrawal', 'expense', 'refund')
    return list
  }, [canOperate, canClose])

  const [type, setType] = useState<ManualEntryType>(available[0] ?? 'supply')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  if (available.length === 0) {
    return (
      <section className="rounded-card border border-line bg-surface p-4">
        <p className="text-sm text-slate">
          Seu acesso permite acompanhar o turno, mas não lançar movimentos no caixa.
        </p>
      </section>
    )
  }

  async function submit() {
    const value = toNumber(amount)
    if (value <= 0) {
      setFeedback({ kind: 'bad', text: 'Informe um valor maior que zero.' })
      return
    }
    if (description.trim().length < 3) {
      setFeedback({ kind: 'bad', text: 'Descreva o motivo em pelo menos 3 caracteres.' })
      return
    }

    setBusy(true)
    setFeedback(null)
    try {
      await onSubmit({ type, amount: value, description: description.trim() })
      setAmount('')
      setDescription('')
      setFeedback({ kind: 'ok', text: `${ENTRY_LABEL[type]} lançada no turno.` })
    } catch (err) {
      setFeedback({ kind: 'bad', text: errorMessage(err, 'Não foi possível lançar.') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="entry-title"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
    >
      <h3 id="entry-title" className="text-sm font-semibold text-ink">
        Lançar movimento
      </h3>

      {feedback && <Feedback {...feedback} />}

      <div role="group" aria-label="Tipo de movimento" className="flex flex-wrap gap-2">
        {available.map((option) => {
          const active = option === type
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setType(option)
                setFeedback(null)
              }}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border-brand bg-brand text-white'
                  : 'border-line bg-canvas text-ink hover:border-brand/40'
              }`}
            >
              {ENTRY_LABEL[option]}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-36 flex-col gap-1">
          <label htmlFor="entry-amount" className="text-xs font-medium uppercase tracking-wide text-slate">
            Valor
          </label>
          <div className="flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-2">
            <span aria-hidden="true" className="text-xs text-slate">
              R$
            </span>
            <input
              id="entry-amount"
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

        <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <label
            htmlFor="entry-description"
            className="text-xs font-medium uppercase tracking-wide text-slate"
          >
            Motivo
          </label>
          <input
            id="entry-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              type === 'supply' ? 'Reforço de troco' : 'Retirada para o cofre'
            }
            className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink"
          />
        </div>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="inline-flex h-[2.625rem] items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white transition-colors hover:bg-ink-soft disabled:opacity-60"
        >
          {busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
          Lançar
        </button>
      </div>
    </section>
  )
}

// ─── Fechamento ───────────────────────────────────────────────────────────────

function CloseCashCard({
  expectedCash,
  canClose,
  onClose,
}: {
  expectedCash: number
  canClose: boolean
  onClose: (countedCash: number, notes: string) => Promise<void>
}) {
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  // A diferenca so aparece depois que o operador digita: mostrar o esperado
  // antes de contar transforma a conferencia em copia de numero.
  const typed = counted.trim() !== ''
  const difference = typed ? Math.round((toNumber(counted) - expectedCash) * 100) / 100 : null

  async function submit() {
    if (!typed) {
      setFeedback({ kind: 'bad', text: 'Conte a gaveta e informe o valor encontrado.' })
      return
    }
    setBusy(true)
    setFeedback(null)
    try {
      await onClose(toNumber(counted), notes.trim())
      setCounted('')
      setNotes('')
    } catch (err) {
      setFeedback({ kind: 'bad', text: errorMessage(err, 'Não foi possível fechar o caixa.') })
    } finally {
      setBusy(false)
    }
  }

  if (!canClose) {
    return (
      <section className="rounded-card border border-line bg-surface p-5">
        <h3 className="text-sm font-semibold text-ink">Fechamento</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate">
          Quem confere a gaveta precisa da permissão de fechamento. Avise o gerente
          quando terminar o turno.
        </p>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="close-title"
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
    >
      <div className="flex flex-col gap-1">
        <h3 id="close-title" className="text-sm font-semibold text-ink">
          Fechar o turno
        </h3>
        <p className="text-xs leading-relaxed text-slate">
          Conte o dinheiro em espécie da gaveta e informe abaixo. O sistema compara com o
          esperado e registra a diferença.
        </p>
      </div>

      {feedback && <Feedback {...feedback} />}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="counted-cash" className="text-sm font-medium text-ink">
          Dinheiro contado na gaveta
        </label>
        <div className="flex items-center gap-2 rounded-md border border-line bg-canvas px-3 py-2">
          <span aria-hidden="true" className="text-sm text-slate">
            R$
          </span>
          <input
            id="counted-cash"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            placeholder="0,00"
            className="w-full bg-transparent text-base text-ink outline-none"
          />
        </div>
      </div>

      {difference !== null && (
        <dl className="flex flex-col gap-1 rounded-md border border-line bg-canvas px-3 py-2.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate">Esperado</dt>
            <dd className="text-ink">{brl(expectedCash)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate">Diferença</dt>
            <dd
              className={`font-semibold ${
                difference === 0 ? 'text-good' : difference > 0 ? 'text-warn' : 'text-bad'
              }`}
            >
              {difference > 0 ? '+' : ''}
              {brl(difference)}
            </dd>
          </div>
          <p className="pt-1 text-xs leading-relaxed text-slate">
            {difference === 0
              ? 'A gaveta confere com o esperado.'
              : difference > 0
                ? 'Sobrou dinheiro. Confira se alguma venda deixou de ser lançada.'
                : 'Faltou dinheiro. Confira sangrias e trocos antes de fechar.'}
          </p>
        </dl>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="closing-notes" className="text-sm font-medium text-ink">
          Observação do fechamento <span className="font-normal text-slate">(opcional)</span>
        </label>
        <input
          id="closing-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Faltou R$ 2 do troco da mesa 4"
          className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink"
        />
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="inline-flex items-center justify-center gap-2 self-start rounded-md border border-line px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-bad/40 hover:bg-bad-soft hover:text-bad disabled:opacity-60"
      >
        {busy ? (
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : (
          <Lock aria-hidden="true" className="h-4 w-4" />
        )}
        {busy ? 'Fechando...' : 'Fechar caixa'}
      </button>
    </section>
  )
}

// ─── Extrato do turno ─────────────────────────────────────────────────────────

function EntryList({ registerId }: { registerId: string }) {
  // Chaveado pelo id do turno: ao fechar um e abrir outro, o SWR troca de chave
  // e o extrato do turno anterior nao "vaza" para a tela do novo.
  const { data, isLoading, error } = useSWR<CashEntryRow[]>(
    `/api/cash/${registerId}/entries`,
    swrFetcher,
    { refreshInterval: 20_000 },
  )

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 px-5 py-6 text-sm text-slate">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Carregando movimentos...
      </p>
    )
  }

  if (error) {
    return (
      <p role="alert" className="px-5 py-6 text-sm text-bad">
        {errorMessage(error, 'Não foi possível carregar os movimentos.')}
      </p>
    )
  }

  const entries = data ?? []
  if (entries.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-slate">
        Nenhum movimento neste turno ainda. As vendas do PDV aparecem aqui automaticamente.
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-line">
      {entries.map((entry) => {
        const inflow = INFLOW.includes(entry.type)
        const Icon = inflow ? ArrowUpRight : ArrowDownLeft
        return (
          <li key={entry.id} className="flex items-center gap-3 px-5 py-3">
            <span
              aria-hidden="true"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                inflow ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'
              }`}
            >
              <Icon className="h-4 w-4" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{entry.description}</p>
              <p className="truncate text-xs text-slate">
                {ENTRY_LABEL[entry.type]} · {METHOD_LABEL[entry.paymentMethod] ?? entry.paymentMethod}{' '}
                · {dateTime(entry.createdAt)} · {personName(entry.createdBy)}
              </p>
            </div>

            <span
              className={`shrink-0 text-sm font-semibold ${
                inflow ? 'text-good' : 'text-bad'
              }`}
            >
              {inflow ? '+' : '−'}
              {brl(Number(entry.amount))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

// ─── Historico de turnos fechados ─────────────────────────────────────────────

function ClosedHistory() {
  const { data, isLoading } = useSWR<CashRegisterRow[]>('/api/cash/history?limit=15', swrFetcher)

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 px-5 py-6 text-sm text-slate">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Carregando turnos anteriores...
      </p>
    )
  }

  const rows = data ?? []
  if (rows.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-slate">
        Nenhum turno fechado até agora.
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-line">
      {rows.map((row) => {
        const diff = Number(row.difference ?? 0)
        return (
          <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
            <div className="min-w-[12rem] flex-1">
              <p className="text-sm font-medium text-ink">
                {row.closedAt ? dateTime(row.closedAt) : '—'}
              </p>
              <p className="text-xs text-slate">
                Abriu {personName(row.openedBy)} · Fechou {personName(row.closedBy)}
              </p>
            </div>

            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate">Contado</p>
              <p className="text-sm text-ink">{brl(Number(row.closingBalance ?? 0))}</p>
            </div>

            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate">Diferença</p>
              <p
                className={`text-sm font-semibold ${
                  diff === 0 ? 'text-good' : diff > 0 ? 'text-warn' : 'text-bad'
                }`}
              >
                {diff > 0 ? '+' : ''}
                {brl(diff)}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ─── Tela ─────────────────────────────────────────────────────────────────────

export function CashRegisterPage() {
  const { can } = useAuth()
  const cash = useCashRegister()

  const canOperate = can('cash:operate')
  const canClose = can('cash:close')

  const [closedFlash, setClosedFlash] = useState<string | null>(null)

  if (cash.isLoading) {
    return (
      <p className="flex items-center gap-2 py-16 text-sm text-slate">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Consultando o caixa...
      </p>
    )
  }

  if (cash.error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad"
      >
        {errorMessage(cash.error, 'Não foi possível consultar o caixa.')}
      </p>
    )
  }

  const { register, summary } = cash

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-ink">Caixa</h2>
        <p className="text-sm leading-relaxed text-slate">
          O turno reúne todas as vendas e movimentos de dinheiro do período. O PDV só
          libera vendas com o caixa aberto.
        </p>
      </header>

      {closedFlash && <Feedback kind="ok" text={closedFlash} />}

      {!register || !summary ? (
        <>
          <OpenCashCard
            canOpen={canOperate}
            onOpen={async (opening, notes) => {
              setClosedFlash(null)
              await cash.open(opening, notes || undefined)
            }}
          />

          <section aria-labelledby="history-title" className="flex flex-col gap-3">
            <h3 id="history-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
              <CalendarClock aria-hidden="true" className="h-4 w-4 text-slate" />
              Turnos anteriores
            </h3>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <ClosedHistory />
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-card border border-good/30 bg-good-soft px-4 py-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-good/15 text-good"
            >
              <Wallet className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-good">Caixa aberto</p>
              <p className="text-xs text-ink">
                Desde {dateTime(register.openedAt)} por {personName(register.openedBy)}
              </p>
            </div>
            <span className="text-xs text-ink">
              {summary.salesCount} venda{summary.salesCount === 1 ? '' : 's'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Esperado na gaveta"
              value={brl(summary.expectedCash)}
              hint="Somente espécie."
              tone="brand"
            />
            <StatCard
              label="Vendas do turno"
              value={brl(summary.totalSales)}
              hint="Todas as formas de pagamento."
            />
            <StatCard label="Abertura" value={brl(summary.openingBalance)} hint="Troco inicial." />
            <StatCard
              label="Saídas"
              value={brl(summary.withdrawals + summary.expenses + summary.refunds)}
              hint="Sangrias, despesas e estornos."
              tone={summary.withdrawals + summary.expenses + summary.refunds > 0 ? 'bad' : 'neutral'}
            />
          </div>

          <section
            aria-labelledby="methods-title"
            className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
          >
            <h3 id="methods-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Banknote aria-hidden="true" className="h-4 w-4 text-slate" />
              Vendas por forma de pagamento
            </h3>
            {Object.keys(summary.byMethod).length === 0 ? (
              <p className="text-sm text-slate">Nenhuma venda lançada neste turno ainda.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {Object.entries(summary.byMethod).map(([method, info]) => (
                  <li
                    key={method}
                    className="flex min-w-[9rem] flex-col gap-0.5 rounded-md border border-line bg-canvas px-3 py-2"
                  >
                    <span className="text-xs font-medium uppercase tracking-wide text-slate">
                      {METHOD_LABEL[method] ?? method}
                    </span>
                    <span className="text-sm font-semibold text-ink">
                      {brl(info.amount)}
                    </span>
                    <span className="text-xs text-slate">
                      {info.count} venda{info.count === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {summary.changeGiven > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-slate">
                <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                Troco devolvido no turno: {brl(summary.changeGiven)}
              </p>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <EntryForm
              canOperate={canOperate}
              canClose={canClose}
              onSubmit={async (input) => {
                await cash.addEntry(input)
              }}
            />

            <CloseCashCard
              expectedCash={summary.expectedCash}
              canClose={canClose}
              onClose={async (countedCash, notes) => {
                const result = await cash.close(register.id, countedCash, notes || undefined)
                const diff = Number(result.register.difference ?? 0)
                setClosedFlash(
                  diff === 0
                    ? 'Caixa fechado sem diferença. A gaveta conferiu.'
                    : `Caixa fechado com diferença de ${brl(diff)}.`,
                )
              }}
            />
          </div>

          <section aria-labelledby="entries-title" className="flex flex-col gap-3">
            <h3 id="entries-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Receipt aria-hidden="true" className="h-4 w-4 text-slate" />
              Movimentos do turno
            </h3>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <EntryList registerId={register.id} />
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default CashRegisterPage
