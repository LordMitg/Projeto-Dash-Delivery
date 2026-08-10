/**
 * KDS — o painel da cozinha (Kanban de pedidos em tempo real).
 *
 * A rota `/cozinha` renderizava o proprio PDV: a cozinha nunca teve uma tela.
 * Este componente e a tela real.
 *
 * Duas regras que moldam o desenho:
 *
 * 1. **O tempo e a informacao principal.** Numa cozinha o que importa nao e
 *    "quais pedidos existem", e "qual esta atrasado". Por isso o cronometro de
 *    cada pedido e o elemento mais forte do cartao e muda de cor conforme
 *    envelhece — e a unica decoracao que carrega significado.
 *
 * 2. **A conexao e visivel.** Se o socket cair, esta tela mostraria a fila
 *    congelada como se fosse a atual e a cozinha pararia de produzir sem saber.
 *    O aviso de conexao perdida e o SWR de 30s existem para esse caso.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, Loader2, RefreshCw, WifiOff } from 'lucide-react'
import { apiPatch, errorMessage, swrFetcher } from '../lib/api'
import { useRealtime } from '../hooks/useRealtime'

type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'dispatched'
  | 'delivered'
  | 'cancelled'

interface OrderItem {
  id: string
  quantity: number
  observations?: string | null
  selectedProteinName?: string | null
  product?: { id: string; name: string; category?: string | null } | null
}

interface KitchenOrder {
  id: string
  orderNumber: string
  status: OrderStatus
  orderType: 'delivery' | 'balcao' | 'mesa'
  observations?: string | null
  createdAt: string
  customer?: { name?: string | null } | null
  orderItems?: OrderItem[]
}

/** Colunas do Kanban. `dispatched`/`delivered` saem da tela: ja foram embora. */
const COLUMNS: { key: string; label: string; statuses: OrderStatus[] }[] = [
  { key: 'queue', label: 'Na fila', statuses: ['pending', 'confirmed'] },
  { key: 'preparing', label: 'Preparando', statuses: ['preparing'] },
  { key: 'ready', label: 'Pronto', statuses: ['ready'] },
]

const TYPE_LABEL: Record<KitchenOrder['orderType'], string> = {
  delivery: 'Delivery',
  balcao: 'Balcão',
  mesa: 'Mesa',
}

/**
 * Proximo status ao clicar no botao do cartao, espelhando
 * `ALLOWED_TRANSITIONS` do backend. O servidor rejeita transicao invalida com
 * 409, entao aqui so oferecemos o caminho que ele aceita.
 */
function nextStep(order: KitchenOrder): { status: OrderStatus; label: string } | null {
  switch (order.status) {
    case 'pending':
    case 'confirmed':
      return { status: 'preparing', label: 'Iniciar' }
    case 'preparing':
      return { status: 'ready', label: 'Pronto' }
    case 'ready':
      return order.orderType === 'delivery'
        ? { status: 'dispatched', label: 'Despachar' }
        : { status: 'delivered', label: 'Entregue' }
    default:
      return null
  }
}

/** Minutos decorridos desde a criacao do pedido. */
function minutesSince(iso: string, now: number): number {
  const created = new Date(iso).getTime()
  if (Number.isNaN(created)) return 0
  return Math.max(0, Math.floor((now - created) / 60000))
}

/**
 * Faixas de atraso. Sao o unico uso de cor semantica na tela, justamente para
 * que o olho encontre o pedido atrasado sem ler nada.
 */
function ageTone(minutes: number): string {
  if (minutes >= 15) return 'bg-bad text-white'
  if (minutes >= 8) return 'bg-warn text-white'
  return 'bg-good-soft text-good'
}

export function KitchenDisplay() {
  const {
    data: orders,
    isLoading,
    mutate,
  } = useSWR<KitchenOrder[]>('/api/orders', swrFetcher, {
    // Rede de seguranca: se um evento se perder (socket caiu e voltou entre
    // dois pedidos), a fila se corrige sozinha em ate 30s.
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })

  const [moving, setMoving] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Relogio proprio: sem ele os cronometros so avancariam quando chegasse um
  // evento novo, e um pedido parado ficaria eternamente marcado como "0 min".
  const [now, setNow] = useState(() => Date.now())

  // Tick de 20s. Nao precisa ser por segundo: a cozinha reage em minutos, e
  // re-renderizar a cada segundo gastaria bateria do tablet na parede.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 20_000)
    return () => window.clearInterval(id)
  }, [])

  const refresh = useCallback(() => void mutate(), [mutate])

  const { status: realtimeStatus } = useRealtime({
    handlers: {
      // Revalida em vez de inserir na lista local: o payload do evento e o
      // pedido cru, e a lista precisa dos `include` do endpoint (produto,
      // cliente). Confiar no payload mostraria cartoes sem os itens.
      'order:created': refresh,
      'order:status': refresh,
      'order:cancelled': refresh,
    },
  })

  const grouped = useMemo(() => {
    const list = orders ?? []
    return COLUMNS.map((col) => ({
      ...col,
      // Mais antigo primeiro: a cozinha produz por ordem de chegada.
      orders: list
        .filter((o) => col.statuses.includes(o.status))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    }))
  }, [orders])

  async function advance(order: KitchenOrder) {
    const step = nextStep(order)
    if (!step) return
    setMoving(order.id)
    setActionError(null)
    try {
      await apiPatch(`/api/orders/${order.id}/status`, { status: step.status })
      await mutate()
    } catch (err) {
      // Erro na tela, nao `alert`: o backend recusa transicao invalida (409) e
      // a cozinha precisa ler o motivo sem travar o resto do painel.
      setActionError(errorMessage(err, 'Nao foi possivel mover o pedido.'))
    } finally {
      setMoving(null)
    }
  }

  return (
    <section aria-labelledby="kds-title" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <h2 id="kds-title" className="text-xl font-semibold text-ink">
          Cozinha
        </h2>

        {/* Estado da conexao: a tela precisa admitir quando nao esta ao vivo. */}
        {realtimeStatus === 'connected' ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-good-soft px-2.5 py-1 text-xs font-medium text-good">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-good" />
            Ao vivo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn">
            {realtimeStatus === 'connecting' ? (
              <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
            ) : (
              <WifiOff aria-hidden="true" className="h-3 w-3" />
            )}
            {realtimeStatus === 'connecting' ? 'Conectando...' : 'Sem conexão ao vivo'}
          </span>
        )}

        <button
          type="button"
          onClick={refresh}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas"
        >
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
          Atualizar
        </button>
      </header>

      {realtimeStatus === 'disconnected' && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          A atualização automática caiu. A fila é recarregada a cada 30 segundos, mas
          confirme no PDV antes de fechar a cozinha.
        </p>
      )}

      {actionError && (
        <p
          role="alert"
          className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad"
        >
          {actionError}
        </p>
      )}

      {isLoading ? (
        <p className="flex items-center gap-2 py-12 text-sm text-slate">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Carregando a fila...
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {grouped.map((col) => (
            <div key={col.key} className="flex min-w-0 flex-col gap-3">
              <div className="flex items-baseline justify-between border-b-2 border-line pb-2">
                <h3 className="text-sm font-semibold tracking-wide text-ink uppercase">
                  {col.label}
                </h3>
                <span className="text-sm text-slate">{col.orders.length}</span>
              </div>

              {col.orders.length === 0 ? (
                <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-slate">
                  Nada aqui
                </p>
              ) : (
                col.orders.map((order) => {
                  const minutes = minutesSince(order.createdAt, now)
                  const step = nextStep(order)
                  return (
                    <article
                      key={order.id}
                      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-ink">
                          #{order.orderNumber}
                        </span>
                        <span className="rounded bg-canvas px-1.5 py-0.5 text-xs font-medium text-slate">
                          {TYPE_LABEL[order.orderType] ?? order.orderType}
                        </span>
                        <span
                          className={`ml-auto rounded px-1.5 py-0.5 text-xs font-bold ${ageTone(minutes)}`}
                        >
                          {minutes} min
                        </span>
                      </div>

                      <ul className="flex flex-col gap-1.5 text-sm text-ink">
                        {(order.orderItems ?? []).map((item) => (
                          <li key={item.id} className="leading-relaxed">
                            <span className="font-semibold">{item.quantity}×</span>{' '}
                            {item.product?.name ?? 'Item'}
                            {item.selectedProteinName && (
                              <span className="text-slate"> — {item.selectedProteinName}</span>
                            )}
                            {item.observations && (
                              // Observacao do item em destaque: e o que faz a
                              // cozinha errar quando passa desapercebido.
                              <span className="mt-0.5 block text-xs font-medium text-warn">
                                {item.observations}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>

                      {order.observations && (
                        <p className="rounded bg-warn-soft px-2 py-1.5 text-xs font-medium text-warn">
                          {order.observations}
                        </p>
                      )}

                      {step && (
                        <button
                          type="button"
                          onClick={() => void advance(order)}
                          disabled={moving === order.id}
                          className="mt-auto rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
                        >
                          {moving === order.id ? 'Movendo...' : step.label}
                        </button>
                      )}
                    </article>
                  )
                })
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default KitchenDisplay
