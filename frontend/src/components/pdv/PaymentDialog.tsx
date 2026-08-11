/**
 * Fechamento da venda: formas de pagamento, troco e confirmacao.
 *
 * Este dialogo existe separado da comanda porque e o unico momento em que o
 * operador para de olhar produtos e passa a olhar dinheiro. Misturar as duas
 * coisas na mesma tela e o que faz o caixa errar troco na correria.
 *
 * A regra central: a soma das parcelas tem de fechar EXATAMENTE com o total. O
 * botao de confirmar fica bloqueado enquanto faltar ou sobrar, e o valor que
 * falta aparece grande — o operador nao deveria precisar fazer a conta de
 * cabeca.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Banknote, Loader2, Plus, X } from 'lucide-react'

import {
  brl,
  PAYMENT_LABELS,
  PAYMENT_ORDER,
  round2,
  type PaymentMethod,
  type PaymentSplit,
} from './types'

interface Props {
  total: number
  submitting: boolean
  error: string | null
  /**
   * Forma escolhida no painel do pedido, para o dialogo abrir ja nela.
   *
   * O operador costuma perguntar "como vai pagar?" enquanto monta a comanda; se
   * o dialogo ignorasse essa resposta, ele teria de informa-la duas vezes.
   */
  initialMethod?: PaymentMethod
  onCancel: () => void
  onConfirm: (splits: PaymentSplit[]) => void
}

/** Cedulas do real, para os atalhos de troco. */
const CASH_NOTES = [5, 10, 20, 50, 100, 200]

let splitSeq = 0
function nextSplitId() {
  splitSeq += 1
  return `s${splitSeq}`
}

export function PaymentDialog({
  total,
  submitting,
  error,
  initialMethod = 'cash',
  onCancel,
  onConfirm,
}: Props) {
  /**
   * Comeca com uma parcela unica cobrindo o total, na forma que o operador ja
   * marcou no painel: o caso mais comum do balcao resolve em um clique, sem
   * digitar valor.
   */
  const [splits, setSplits] = useState<PaymentSplit[]>(() => [
    { id: nextSplitId(), method: initialMethod, amount: round2(total), changeFor: null },
  ])

  const firstFieldRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  // ── Contas ────────────────────────────────────────────────────────────────
  const paid = round2(splits.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0))
  const missing = round2(total - paid)

  /** Troco: so a parcela em especie gera troco. */
  const change = useMemo(() => {
    const cashSplit = splits.find((s) => s.method === 'cash')
    if (!cashSplit || cashSplit.changeFor == null) return 0
    return round2(Math.max(0, cashSplit.changeFor - cashSplit.amount))
  }, [splits])

  const cashSplit = splits.find((s) => s.method === 'cash') ?? null

  /**
   * Nota insuficiente: o cliente entregou menos do que a parte em dinheiro.
   * Bloqueia a confirmacao porque o servidor tambem recusaria.
   */
  const shortCash =
    cashSplit != null && cashSplit.changeFor != null && cashSplit.changeFor < cashSplit.amount

  const balanced = Math.abs(missing) < 0.01
  const canConfirm = balanced && !shortCash && !submitting && total > 0

  // ── Acoes ─────────────────────────────────────────────────────────────────

  function setMethod(id: string, method: PaymentMethod) {
    setSplits((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, method, changeFor: method === 'cash' ? s.changeFor : null } : s,
      ),
    )
  }

  function setAmount(id: string, amount: number) {
    setSplits((prev) => prev.map((s) => (s.id === id ? { ...s, amount } : s)))
  }

  function setChangeFor(id: string, changeFor: number | null) {
    setSplits((prev) => prev.map((s) => (s.id === id ? { ...s, changeFor } : s)))
  }

  /**
   * Adiciona uma parcela ja preenchida com o que falta.
   *
   * Preencher com o restante em vez de zero economiza a digitacao no caso real:
   * "R$ 50 no cartao e o resto em dinheiro".
   */
  function addSplit() {
    const remaining = round2(Math.max(0, total - paid))
    // Evita duas parcelas em dinheiro: o servidor recusa, porque o troco ficaria
    // ambiguo entre as duas.
    const used = new Set(splits.map((s) => s.method))
    const suggested = PAYMENT_ORDER.find((m) => !used.has(m)) ?? 'credit'
    setSplits((prev) => [
      ...prev,
      { id: nextSplitId(), method: suggested, amount: remaining, changeFor: null },
    ])
  }

  function removeSplit(id: string) {
    setSplits((prev) => (prev.length === 1 ? prev : prev.filter((s) => s.id !== id)))
  }

  /** Joga todo o restante nesta parcela. */
  function fillRemaining(id: string) {
    const others = splits.filter((s) => s.id !== id).reduce((sum, s) => sum + s.amount, 0)
    setAmount(id, round2(Math.max(0, total - others)))
  }

  const methodsInUse = splits.map((s) => s.method)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pay-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl">
        {/* Cabecalho: o total e a informacao mais importante da tela */}
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <h2 id="pay-title" className="text-lg font-semibold text-ink">
              Fechar venda
            </h2>
            <p className="mt-0.5 text-sm text-slate">
              Escolha como o cliente vai pagar. É possível dividir em várias formas.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar pagamento"
            className="rounded-md p-1.5 text-slate transition-colors hover:bg-canvas hover:text-ink"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Total a pagar */}
          <div className="flex items-baseline justify-between rounded-card bg-canvas px-4 py-3">
            <span className="text-sm font-medium text-slate">Total a pagar</span>
            <span className="text-2xl font-bold tabular-nums text-ink">{brl(total)}</span>
          </div>

          {/* Parcelas */}
          <ul className="mt-5 flex flex-col gap-4">
            {splits.map((split, index) => (
              <li key={split.id} className="rounded-card border border-line p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold tracking-wide text-slate uppercase">
                    {splits.length > 1 ? `Forma ${index + 1}` : 'Forma de pagamento'}
                  </span>
                  {splits.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSplit(split.id)}
                      className="flex items-center gap-1 text-xs font-medium text-bad transition-opacity hover:opacity-75"
                    >
                      <X aria-hidden="true" className="h-3.5 w-3.5" />
                      Remover
                    </button>
                  )}
                </div>

                {/* Formas: botoes grandes, nao um select — no toque, procurar
                    dentro de um dropdown custa segundos que a fila sente. */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {PAYMENT_ORDER.map((method) => {
                    const active = split.method === method
                    // Dinheiro duplicado e recusado pelo servidor.
                    const blocked =
                      method === 'cash' && !active && methodsInUse.includes('cash')
                    return (
                      <button
                        key={method}
                        ref={index === 0 && method === initialMethod ? firstFieldRef : undefined}
                        type="button"
                        disabled={blocked}
                        onClick={() => setMethod(split.id, method)}
                        aria-pressed={active}
                        className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          active
                            ? 'bg-brand text-white'
                            : blocked
                              ? 'cursor-not-allowed bg-canvas text-slate/40'
                              : 'bg-canvas text-ink hover:bg-line'
                        }`}
                      >
                        {PAYMENT_LABELS[method]}
                      </button>
                    )
                  })}
                </div>

                {/* Valor da parcela */}
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate">Valor</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={Number.isFinite(split.amount) ? split.amount : ''}
                      onChange={(e) => setAmount(split.id, Number(e.target.value))}
                      className="w-32 rounded-md border border-line bg-surface px-3 py-2 text-base tabular-nums text-ink focus:border-brand focus:outline-none"
                    />
                  </label>
                  {splits.length > 1 && (
                    <button
                      type="button"
                      onClick={() => fillRemaining(split.id)}
                      className="rounded-md border border-line px-3 py-2 text-xs font-medium text-slate transition-colors hover:border-brand hover:text-brand"
                    >
                      Usar o restante
                    </button>
                  )}
                </div>

                {/* Troco: so aparece em dinheiro, porque so ai existe */}
                {split.method === 'cash' && (
                  <div className="mt-4 border-t border-line pt-4">
                    <div className="flex items-center gap-2">
                      <Banknote aria-hidden="true" className="h-4 w-4 text-slate" />
                      <span className="text-xs font-medium text-slate">
                        Quanto o cliente entregou?
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="Valor recebido"
                        value={split.changeFor ?? ''}
                        onChange={(e) =>
                          setChangeFor(split.id, e.target.value === '' ? null : Number(e.target.value))
                        }
                        className="w-36 rounded-md border border-line bg-surface px-3 py-2 text-base tabular-nums text-ink focus:border-brand focus:outline-none"
                      />
                      {/* Atalhos de cedula: o operador clica na nota que recebeu */}
                      {CASH_NOTES.filter((n) => n >= split.amount).slice(0, 4).map((note) => (
                        <button
                          key={note}
                          type="button"
                          onClick={() => setChangeFor(split.id, note)}
                          className="rounded-md bg-canvas px-2.5 py-1.5 text-xs font-semibold tabular-nums text-ink transition-colors hover:bg-line"
                        >
                          {note}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setChangeFor(split.id, null)}
                        className="text-xs font-medium text-slate underline-offset-2 hover:underline"
                      >
                        Valor exato
                      </button>
                    </div>

                    {shortCash && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-bad">
                        <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
                        O valor recebido é menor que a parte em dinheiro.
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Dividir em outra forma */}
          {splits.length < 4 && (
            <button
              type="button"
              onClick={addSplit}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-line py-3 text-sm font-medium text-slate transition-colors hover:border-brand hover:text-brand"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Dividir em outra forma de pagamento
            </button>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-md bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad"
            >
              <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}
        </div>

        {/* Rodape fixo: saldo e confirmacao */}
        <footer className="border-t border-line bg-canvas px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Falta / Sobra / Troco: o numero que o operador precisa ver */}
            {!balanced ? (
              <div className="flex flex-col">
                <span className="text-xs font-medium text-slate">
                  {missing > 0 ? 'Ainda falta' : 'Passou do total'}
                </span>
                <span
                  className={`text-xl font-bold tabular-nums ${
                    missing > 0 ? 'text-warn' : 'text-bad'
                  }`}
                >
                  {brl(Math.abs(missing))}
                </span>
              </div>
            ) : change > 0 ? (
              <div className="flex flex-col">
                <span className="text-xs font-medium text-slate">Troco para o cliente</span>
                <span className="text-xl font-bold tabular-nums text-good">
                  {brl(change)}
                </span>
              </div>
            ) : (
              <div className="flex flex-col">
                <span className="text-xs font-medium text-slate">Pagamento</span>
                <span className="text-xl font-bold tabular-nums text-good">Exato</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={submitting}
                className="rounded-md px-4 py-3 text-sm font-medium text-slate transition-colors hover:bg-line disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => onConfirm(splits)}
                disabled={!canConfirm}
                className="flex min-w-44 items-center justify-center gap-2 rounded-md bg-brand px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-slate/40"
              >
                {submitting ? (
                  <>
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    Registrando...
                  </>
                ) : (
                  'Confirmar venda'
                )}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
