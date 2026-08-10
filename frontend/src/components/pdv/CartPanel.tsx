/**
 * Comanda: os itens da venda em andamento, os totais e o botao de fechar.
 *
 * O total fica grande e em fonte monoespacada de proposito. E o numero que o
 * operador fala em voz alta para o cliente e o que ele confere antes de receber;
 * um total pequeno, no meio de outros textos do mesmo tamanho, e lido errado.
 *
 * Cada linha mostra proteina, adicionais e observacao porque a conferencia
 * acontece aqui — depois de imprimir, corrigir custa uma comanda nova.
 */

import { Minus, Pencil, Plus, ShoppingCart, Trash2 } from 'lucide-react'

import { brl, lineTotal, type CartItem } from './types'

interface Props {
  items: CartItem[]
  subtotal: number
  deliveryFee: number
  discount: number
  total: number
  disabled: boolean
  onChangeQuantity: (lineId: string, delta: number) => void
  onRemove: (lineId: string) => void
  onEdit: (lineId: string) => void
  onClear: () => void
  onCheckout: () => void
}

export function CartPanel({
  items,
  subtotal,
  deliveryFee,
  discount,
  total,
  disabled,
  onChangeQuantity,
  onRemove,
  onEdit,
  onClear,
  onCheckout,
}: Props) {
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0)

  return (
    <section
      aria-label="Comanda"
      className="flex w-full min-w-0 flex-col border-t border-white/10 bg-ink-soft lg:w-[24rem] lg:border-t-0 lg:border-l xl:w-[26rem]"
    >
      {/* Cabecalho */}
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <ShoppingCart aria-hidden="true" className="h-4 w-4 text-brand" />
          <h2 className="text-sm font-semibold text-white">Comanda</h2>
          {itemCount > 0 && (
            <span className="rounded-full bg-brand px-2 py-0.5 font-mono text-xs font-bold tabular-nums text-white">
              {itemCount}
            </span>
          )}
        </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-medium text-white/50 transition-colors hover:text-bad"
          >
            Limpar
          </button>
        )}
      </header>

      {/* Itens */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <ShoppingCart aria-hidden="true" className="h-8 w-8 text-white/20" />
            <p className="text-sm font-medium text-white/50">Nenhum item ainda</p>
            <p className="text-xs text-white/30">Toque nos produtos para montar o pedido.</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {items.map((item) => (
              <li key={item.lineId} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug font-medium text-white">
                      {item.product.name}
                    </p>

                    {/* Proteina escolhida */}
                    {item.selectedProtein && (
                      <p className="mt-0.5 text-xs text-white/60">
                        {item.selectedProtein.label}
                      </p>
                    )}

                    {/* Adicionais, com o preco de cada um */}
                    {item.addons.length > 0 && (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {item.addons.map((addon) => (
                          <li key={addon.addonId} className="text-xs text-brand">
                            + {addon.quantity > 1 && `${addon.quantity}× `}
                            {addon.name}
                            <span className="ml-1 font-mono tabular-nums text-white/40">
                              {brl(addon.price * addon.quantity)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Observacao da cozinha */}
                    {item.observations && (
                      <p className="mt-1 rounded bg-warn-soft/10 px-1.5 py-0.5 text-xs text-warn">
                        {item.observations}
                      </p>
                    )}
                  </div>

                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-white">
                    {brl(lineTotal(item))}
                  </span>
                </div>

                {/* Controles da linha */}
                <div className="mt-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onChangeQuantity(item.lineId, -1)}
                    aria-label={`Diminuir ${item.product.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-white/5 text-white transition-colors hover:bg-white/10"
                  >
                    <Minus aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-8 text-center font-mono text-sm font-semibold tabular-nums text-white">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChangeQuantity(item.lineId, 1)}
                    aria-label={`Aumentar ${item.product.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md bg-white/5 text-white transition-colors hover:bg-white/10"
                  >
                    <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>

                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(item.lineId)}
                      aria-label={`Editar ${item.product.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(item.lineId)}
                      aria-label={`Remover ${item.product.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-bad/20 hover:text-bad"
                    >
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Totais e fechamento */}
      <footer className="border-t border-white/10 px-4 py-3">
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-white/60">Subtotal</dt>
            <dd className="font-mono tabular-nums text-white/80">{brl(subtotal)}</dd>
          </div>
          {deliveryFee > 0 && (
            <div className="flex justify-between">
              <dt className="text-white/60">Entrega</dt>
              <dd className="font-mono tabular-nums text-white/80">{brl(deliveryFee)}</dd>
            </div>
          )}
          {discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-white/60">Desconto</dt>
              <dd className="font-mono tabular-nums text-good">- {brl(discount)}</dd>
            </div>
          )}
          <div className="mt-1 flex items-baseline justify-between border-t border-white/10 pt-2">
            <dt className="text-sm font-semibold text-white">Total</dt>
            {/* O numero que o operador fala em voz alta. */}
            <dd className="font-mono text-2xl font-bold tabular-nums text-brand">{brl(total)}</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={onCheckout}
          disabled={disabled || items.length === 0}
          className="mt-3 w-full rounded-md bg-brand py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
        >
          Fechar venda
          <span className="ml-2 font-normal opacity-70">F4</span>
        </button>
      </footer>
    </section>
  )
}
