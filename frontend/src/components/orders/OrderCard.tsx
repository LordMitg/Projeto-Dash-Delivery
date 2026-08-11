/**
 * Cartao de um pedido na coluna do painel.
 *
 * O conteudo segue a ordem em que o balcao le em voz alta ao atender: numero,
 * relogio, cliente, o que ele pediu, por onde veio, quanto da, e o que fazer
 * agora. O botao da etapa fica no rodape, do lado do chip de pagamento, porque
 * as duas informacoes decidem juntas se o pedido pode andar ("pendente" +
 * "Aceitar" e uma conversa diferente de "pago online" + "Aceitar").
 */
import { memo } from 'react'
import { Bike, ShoppingBag, Store } from 'lucide-react'
import type { PanelOrder, StageAction } from './types'
import { brl, elapsedLabel, isLate } from './types'

interface Props {
  order: PanelOrder
  /** Acao da etapa atual. Ausente em coluna terminal (entregue/cancelado). */
  action?: StageAction
  /** Cor da coluna, para o cartao herdar a identidade da etapa. */
  accentClass: string
  busy: boolean
  onAdvance: (order: PanelOrder, to: string) => void
  onOpen: (order: PanelOrder) => void
  onDragStart: (order: PanelOrder) => void
  onDragEnd: () => void
}

const TYPE_ICON = {
  delivery: Bike,
  balcao: ShoppingBag,
  mesa: Store,
} as const

const TYPE_LABEL = {
  delivery: 'Delivery',
  balcao: 'Balcão',
  mesa: 'Salão',
} as const

function OrderCardBase({
  order,
  action,
  accentClass,
  busy,
  onAdvance,
  onOpen,
  onDragStart,
  onDragEnd,
}: Props) {
  const late = isLate(order)
  const TypeIcon = TYPE_ICON[order.orderType] ?? ShoppingBag
  const paid = order.paymentStatus === 'paid'

  return (
    <article
      draggable
      onDragStart={(e) => {
        // `setData` e obrigatorio no Firefox: sem ele o drop nunca dispara.
        e.dataTransfer.setData('text/plain', order.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(order)
      }}
      onDragEnd={onDragEnd}
      className={`group cursor-grab rounded-xl border bg-surface p-3 shadow-sm transition-shadow active:cursor-grabbing hover:shadow-md ${
        // Atraso vence a cor da coluna: um pedido de 8 minutos parado precisa
        // saltar da tela mesmo estando na etapa certa.
        late ? 'border-bad' : 'border-line'
      }`}
    >
      {/* Numero + relogio */}
      <header className="flex items-baseline justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpen(order)}
          className="font-display text-sm tabular-nums text-plum underline-offset-2 hover:underline"
        >
          #{order.orderNumber}
        </button>
        <span
          className={`text-xs tabular-nums ${late ? 'font-semibold text-bad' : 'text-slate'}`}
        >
          {late && <span className="mr-1">Atrasado</span>}
          {elapsedLabel(order.createdAt)}
        </span>
      </header>

      <p className="mt-0.5 truncate text-sm font-semibold text-ink">
        {order.customer?.name ?? TYPE_LABEL[order.orderType] ?? 'Cliente'}
      </p>

      {/* Itens: o suficiente para reconhecer o pedido sem abri-lo. */}
      <ul className="mt-1 space-y-0.5">
        {order.items.slice(0, 2).map((item) => (
          <li key={item.id} className="truncate text-xs text-slate">
            <span className="tabular-nums">{item.quantity}x</span> {item.name}
          </li>
        ))}
        {order.items.length > 2 && (
          <li className="text-xs text-slate">
            + {order.items.length - 2} item{order.items.length - 2 === 1 ? '' : 's'}
          </li>
        )}
      </ul>

      {/* Canal + valor */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-slate">
          <TypeIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{order.channel ?? TYPE_LABEL[order.orderType]}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
          {brl(order.total)}
        </span>
      </div>

      {/* Pagamento + acao da etapa */}
      <footer className="mt-2.5 flex items-center justify-between gap-2">
        <span
          className={`rounded-md px-2 py-1 text-[0.6875rem] font-semibold ${
            paid ? 'bg-good-soft text-good' : 'bg-warn-soft text-warn'
          }`}
        >
          {paid ? 'Pago' : 'Pendente'}
        </span>

        {action && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onAdvance(order, action.to)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${accentClass}`}
          >
            {action.label}
          </button>
        )}
      </footer>
    </article>
  )
}

/**
 * `memo` porque o painel re-renderiza a cada evento de socket, e uma noite
 * movimentada tem dezenas de cartoes na tela: sem isso, aceitar um pedido
 * redesenharia todos os outros.
 */
export const OrderCard = memo(OrderCardBase)
