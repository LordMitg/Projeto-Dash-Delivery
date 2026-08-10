/**
 * Comanda: os itens da venda em andamento, os totais e o botao de fechar.
 *
 * O total fica grande de proposito. E o numero que o operador fala em voz alta
 * para o cliente e o que ele confere antes de receber; um total pequeno, no meio
 * de outros textos do mesmo tamanho, e lido errado.
 *
 * Cada linha mostra proteina, adicionais e observacao porque a conferencia
 * acontece aqui — depois de imprimir, corrigir custa uma comanda nova.
 *
 * ── Por que o painel e claro agora ───────────────────────────────────────────
 * Ele era escuro (`bg-ink-soft`) quando o PDV inteiro era escuro. Com a area de
 * trabalho em creme, manter a comanda escura criaria um bloco pesado na borda da
 * tela e romperia a leitura contnua produto → pedido. O peso visual passou a vir
 * da borda e do fundo branco, nao da cor.
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
      className="flex w-full min-w-0 flex-col border-t border-line bg-surface lg:w-[23rem] lg:border-t-0 lg:border-l xl:w-[25rem]"
    >
      {/* ── Cabecalho ── */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-2">
          <ShoppingCart aria-hidden="true" className="h-4 w-4 text-accent" />
          <h2 className="font-display text-base text-plum">Pedido</h2>
          {itemCount > 0 && (
            <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold tabular-nums text-brand-ink">
              {itemCount}
            </span>
          )}
        </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-medium text-slate transition-colors hover:text-bad"
          >
            Limpar
          </button>
        )}
      </header>

      {/* ── Itens ── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <ShoppingCart aria-hidden="true" className="h-8 w-8 text-line" />
            <p className="text-sm font-medium text-slate">Nenhum item ainda</p>
            <p className="text-xs text-slate/70">Toque nos produtos para montar o pedido.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.lineId} className="px-5 py-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug font-semibold text-ink">
                      {item.product.name}
                    </p>

                    {/* Proteina escolhida */}
                    {item.selectedProtein && (
                      <p className="mt-0.5 text-xs text-slate">{item.selectedProtein.label}</p>
                    )}

                    {/* Adicionais, com o preco de cada um */}
                    {item.addons.length > 0 && (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {item.addons.map((addon) => (
                          <li key={addon.addonId} className="text-xs text-accent">
                            + {addon.quantity > 1 && `${addon.quantity}× `}
                            {addon.name}
                            <span className="ml-1 tabular-nums text-slate">
                              {brl(addon.price * addon.quantity)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Observacao da cozinha */}
                    {item.observations && (
                      <p className="mt-1 rounded bg-warn-soft px-1.5 py-0.5 text-xs text-warn">
                        {item.observations}
                      </p>
                    )}
                  </div>

                  <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
                    {brl(lineTotal(item))}
                  </span>
                </div>

                {/* Controles da linha */}
                <div className="mt-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onChangeQuantity(item.lineId, -1)}
                    aria-label={`Diminuir ${item.product.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink transition-colors hover:bg-canvas"
                  >
                    <Minus aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-8 text-center text-sm font-bold tabular-nums text-ink">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onChangeQuantity(item.lineId, 1)}
                    aria-label={`Aumentar ${item.product.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink transition-colors hover:bg-canvas"
                  >
                    <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                  </button>

                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(item.lineId)}
                      aria-label={`Editar ${item.product.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-slate transition-colors hover:bg-canvas hover:text-ink"
                    >
                      <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(item.lineId)}
                      aria-label={`Remover ${item.product.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-slate transition-colors hover:bg-bad-soft hover:text-bad"
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

      {/* ── Totais e fechamento ── */}
      <footer className="shrink-0 border-t border-line bg-canvas px-5 py-4">
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate">Subtotal</dt>
            <dd className="tabular-nums text-ink">{brl(subtotal)}</dd>
          </div>
          {deliveryFee > 0 && (
            <div className="flex justify-between">
              <dt className="text-slate">Entrega</dt>
              <dd className="tabular-nums text-ink">{brl(deliveryFee)}</dd>
            </div>
          )}
          {discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-slate">Desconto</dt>
              <dd className="tabular-nums text-good">- {brl(discount)}</dd>
            </div>
          )}
          <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2.5">
            <dt className="text-sm font-semibold text-ink">Total</dt>
            {/* O numero que o operador fala em voz alta. */}
            <dd className="font-display text-[1.75rem] leading-none tabular-nums text-plum">
              {brl(total)}
            </dd>
          </div>
        </dl>

        {/* Vinho sobre dourado: ver a nota de contraste em index.css. */}
        <button
          type="button"
          onClick={onCheckout}
          disabled={disabled || items.length === 0}
          className="mt-4 w-full rounded-lg bg-brand py-3.5 text-base font-bold text-brand-ink transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-slate"
        >
          Finalizar pedido
          <span className="ml-2 text-sm font-medium opacity-60">F4</span>
        </button>
      </footer>
    </section>
  )
}
