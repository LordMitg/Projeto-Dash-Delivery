/**
 * Montagem de um item: proteina do combo, adicionais e observacao.
 *
 * Um dialogo unico para as tres coisas, porque no atendimento real elas vem
 * juntas na mesma frase do cliente: "marmita de frango, com bacon extra, sem
 * cebola". Tres telas separadas obrigariam o operador a atravessar o mesmo fluxo
 * tres vezes.
 *
 * Serve tanto para adicionar um item novo quanto para editar uma linha que ja
 * esta na comanda.
 */

import { useMemo, useState } from 'react'
import { AlertCircle, Minus, Plus, X } from 'lucide-react'

import {
  brl,
  type ChosenAddon,
  type ComboOption,
  type Product,
  type ProductAddonRow,
} from './types'

interface Props {
  product: Product
  /** Valores atuais, quando esta editando uma linha da comanda. */
  initial?: {
    quantity: number
    observations: string
    selectedProtein: ComboOption | null
    addons: ChosenAddon[]
  }
  onCancel: () => void
  onConfirm: (result: {
    quantity: number
    observations: string
    selectedProtein: ComboOption | null
    addons: ChosenAddon[]
  }) => void
}

export function ItemDialog({ product, initial, onCancel, onConfirm }: Props) {
  const comboOptions = product.comboOptions ?? []
  const addonRows = useMemo(() => product.addons ?? [], [product.addons])

  const [quantity, setQuantity] = useState(initial?.quantity ?? 1)
  const [observations, setObservations] = useState(initial?.observations ?? '')
  const [protein, setProtein] = useState<ComboOption | null>(
    initial?.selectedProtein ?? null,
  )
  const [addons, setAddons] = useState<ChosenAddon[]>(initial?.addons ?? [])

  /** Adicionais agrupados como o cadastro define (ex.: "Adicionais", "Bebida"). */
  const groups = useMemo(() => {
    const map = new Map<string, ProductAddonRow[]>()
    for (const row of addonRows) {
      const list = map.get(row.groupName) ?? []
      list.push(row)
      map.set(row.groupName, list)
    }
    return [...map.entries()]
  }, [addonRows])

  /** Grupos obrigatorios que ainda nao foram atendidos. */
  const missingRequired = useMemo(
    () =>
      groups
        .filter(([, rows]) => rows.some((r) => r.required))
        .filter(([, rows]) => !rows.some((r) => addons.some((a) => a.addonId === r.id)))
        .map(([name]) => name),
    [groups, addons],
  )

  const needsProtein = comboOptions.length > 0
  const proteinMissing = needsProtein && !protein
  const canConfirm = !proteinMissing && missingRequired.length === 0 && quantity > 0

  const addonsUnit = addons.reduce((s, a) => s + a.price * a.quantity, 0)
  const unit = (Number(product.price) || 0) + addonsUnit
  const lineTotal = unit * quantity

  function addonQty(id: string): number {
    return addons.find((a) => a.addonId === id)?.quantity ?? 0
  }

  function changeAddon(row: ProductAddonRow, delta: number) {
    setAddons((prev) => {
      const current = prev.find((a) => a.addonId === row.id)
      const next = Math.min(row.maxQuantity, Math.max(0, (current?.quantity ?? 0) + delta))
      if (next === 0) return prev.filter((a) => a.addonId !== row.id)
      if (current) {
        return prev.map((a) => (a.addonId === row.id ? { ...a, quantity: next } : a))
      }
      return [
        ...prev,
        { addonId: row.id, name: row.name, price: Number(row.price) || 0, quantity: next },
      ]
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/80 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 id="item-title" className="truncate text-lg font-semibold text-ink">
              {product.name}
            </h2>
            <p className="mt-0.5 text-sm tabular-nums text-slate">
              {brl(Number(product.price) || 0)}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fechar"
            className="rounded-md p-1.5 text-slate transition-colors hover:bg-canvas hover:text-ink"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Proteina do combo */}
          {needsProtein && (
            <fieldset>
              <legend className="text-xs font-semibold tracking-wide text-slate uppercase">
                Escolha a proteína
              </legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {comboOptions.map((option) => {
                  const active = protein?.ingredientId === option.ingredientId
                  return (
                    <button
                      key={option.ingredientId}
                      type="button"
                      onClick={() => setProtein(option)}
                      aria-pressed={active}
                      className={`rounded-md px-3.5 py-2.5 text-sm font-medium transition-colors ${
                        active ? 'bg-brand text-white' : 'bg-canvas text-ink hover:bg-line'
                      }`}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          )}

          {/* Adicionais por grupo */}
          {groups.map(([groupName, rows]) => (
            <fieldset key={groupName} className={needsProtein || groups.length > 1 ? 'mt-6' : ''}>
              <legend className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate uppercase">
                {groupName}
                {rows.some((r) => r.required) && (
                  <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[0.625rem] font-semibold text-brand-strong normal-case">
                    obrigatório
                  </span>
                )}
              </legend>
              <ul className="mt-3 flex flex-col gap-2">
                {rows.map((row) => {
                  const qty = addonQty(row.id)
                  return (
                    <li
                      key={row.id}
                      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 transition-colors ${
                        qty > 0 ? 'border-brand bg-brand-soft' : 'border-line'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{row.name}</p>
                        <p className="text-xs tabular-nums text-slate">
                          + {brl(Number(row.price) || 0)}
                          {row.maxQuantity > 1 && ` · até ${row.maxQuantity}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => changeAddon(row, -1)}
                          disabled={qty === 0}
                          aria-label={`Remover ${row.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md bg-surface text-ink transition-colors hover:bg-line disabled:opacity-30"
                        >
                          <Minus aria-hidden="true" className="h-4 w-4" />
                        </button>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums text-ink">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeAddon(row, 1)}
                          disabled={qty >= row.maxQuantity}
                          aria-label={`Adicionar ${row.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md bg-surface text-ink transition-colors hover:bg-line disabled:opacity-30"
                        >
                          <Plus aria-hidden="true" className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          ))}

          {/* Observacao */}
          <label className="mt-6 flex flex-col gap-1.5">
            <span className="text-xs font-semibold tracking-wide text-slate uppercase">
              Observação da cozinha
            </span>
            <textarea
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              rows={2}
              placeholder="Ex: sem cebola, ponto da carne, embalar separado"
              className="resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-slate/60 focus:border-brand focus:outline-none"
            />
          </label>

          {(proteinMissing || missingRequired.length > 0) && (
            <p className="mt-4 flex items-start gap-2 text-xs font-medium text-warn">
              <AlertCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {proteinMissing
                ? 'Escolha a proteína para continuar.'
                : `Escolha uma opção em: ${missingRequired.join(', ')}.`}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-line bg-canvas px-6 py-4">
          {/* Quantidade */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="Diminuir quantidade"
              className="flex h-11 w-11 items-center justify-center rounded-md bg-surface text-ink transition-colors hover:bg-line"
            >
              <Minus aria-hidden="true" className="h-5 w-5" />
            </button>
            <span className="w-10 text-center text-xl font-bold tabular-nums text-ink">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(99, q + 1))}
              aria-label="Aumentar quantidade"
              className="flex h-11 w-11 items-center justify-center rounded-md bg-surface text-ink transition-colors hover:bg-line"
            >
              <Plus aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onConfirm({ quantity, observations, selectedProtein: protein, addons })}
            disabled={!canConfirm}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-brand px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-slate/40"
          >
            <span>{initial ? 'Salvar' : 'Adicionar'}</span>
            <span className="tabular-nums">{brl(lineTotal)}</span>
          </button>
        </footer>
      </div>
    </div>
  )
}
