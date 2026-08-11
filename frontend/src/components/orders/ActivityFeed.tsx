/**
 * Coluna "Atualizacoes": o que aconteceu no dia, do mais recente para o mais
 * antigo.
 *
 * Le `/api/dashboard/activity` (tabela `order_events`) e nao apenas os eventos
 * de socket. Assim quem abre o painel as 15h ve o dia inteiro, e o motivo de um
 * cancelamento continua legivel depois de recarregar a pagina.
 */
import { useMemo, useState } from 'react'
import { Bike, CheckCircle2, Filter, PackagePlus, Utensils, XCircle } from 'lucide-react'
import type { ActivityEvent } from './activityTypes'

interface Props {
  events: ActivityEvent[]
  loading: boolean
}

/** Como cada acontecimento se apresenta na lista. */
function describe(event: ActivityEvent): {
  text: string
  detail: string | null
  Icon: typeof CheckCircle2
  tone: string
} {
  const num = `#${event.orderNumber}`

  if (event.type === 'created') {
    return {
      text: `Novo pedido ${num} recebido`,
      detail: [event.subject, TYPE_LABELS[event.note ?? ''] ?? null].filter(Boolean).join(' · '),
      Icon: PackagePlus,
      tone: 'bg-plum/5 text-plum',
    }
  }

  if (event.type === 'cancelled') {
    return {
      text: `Pedido ${num} cancelado`,
      // O motivo e a razao de existir desta linha: sem ele, o cancelamento
      // aparece sem contexto e alguem vai ter que perguntar no grupo.
      detail: event.note ? `Motivo: ${event.note}` : event.subject,
      Icon: XCircle,
      tone: 'bg-bad-soft text-bad',
    }
  }

  switch (event.toStatus) {
    case 'preparing':
      return {
        text: `Pedido ${num} em preparo`,
        detail: event.subject,
        Icon: Utensils,
        tone: 'bg-warn-soft text-warn',
      }
    case 'ready':
      return {
        text: `Pedido ${num} marcado como pronto`,
        detail: event.subject,
        Icon: CheckCircle2,
        tone: 'bg-good-soft text-good',
      }
    case 'dispatched':
      return {
        text: `Pedido ${num} saiu para entrega`,
        detail: event.subject,
        Icon: Bike,
        tone: 'bg-brand-soft text-accent',
      }
    case 'delivered':
      return {
        text: `Pedido ${num} entregue`,
        detail: event.subject,
        Icon: CheckCircle2,
        tone: 'bg-good-soft text-good',
      }
    default:
      return {
        text: `Pedido ${num} atualizado`,
        detail: event.subject,
        Icon: CheckCircle2,
        tone: 'bg-plum/5 text-plum',
      }
  }
}

const TYPE_LABELS: Record<string, string> = {
  delivery: 'Delivery',
  balcao: 'Balcão',
  mesa: 'Salão',
}

/** "Agora", "3 min atrás", "2 h atrás". */
function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'Agora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min atrás`
  const hours = Math.floor(minutes / 60)
  return `${hours} h atrás`
}

type FeedFilter = 'todos' | 'novos' | 'cancelados'

export function ActivityFeed({ events, loading }: Props) {
  const [filter, setFilter] = useState<FeedFilter>('todos')

  const visible = useMemo(() => {
    if (filter === 'novos') return events.filter((e) => e.type === 'created')
    if (filter === 'cancelados') return events.filter((e) => e.type === 'cancelled')
    return events
  }, [events, filter])

  return (
    <section
      aria-label="Atualizações dos pedidos"
      /* Empilhado (abaixo de 1536px) o feed limita a altura para nao empurrar o
         quadro fora da tela; ao lado (`2xl`) vira coluna fixa de 20rem. */
      className="flex max-h-72 min-h-0 shrink-0 flex-col rounded-2xl border border-line bg-surface 2xl:max-h-none 2xl:w-80"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="font-display text-base text-plum">Atualizações</h2>

        {/* Filtro: numa noite cheia o feed enche de mudancas de etapa e o
            cancelamento — que e o que precisa de acao — se perde no meio. */}
        <label className="flex items-center gap-1.5 text-xs text-slate">
          <Filter aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="sr-only">Filtrar atualizações</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FeedFilter)}
            className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink"
          >
            <option value="todos">Todas</option>
            <option value="novos">Novos pedidos</option>
            <option value="cancelados">Cancelados</option>
          </select>
        </label>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && events.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate">Carregando…</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate">
            {filter === 'todos'
              ? 'Nada aconteceu ainda hoje.'
              : 'Nenhuma atualização deste tipo hoje.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((event) => {
              const { text, detail, Icon, tone } = describe(event)
              return (
                <li key={event.id} className="flex gap-3 px-4 py-3">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-ink">{text}</p>
                    <p className="mt-0.5 flex items-center justify-between gap-2 text-xs text-slate">
                      <span className="truncate">{detail}</span>
                      <span className="shrink-0">{relativeTime(event.createdAt)}</span>
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
