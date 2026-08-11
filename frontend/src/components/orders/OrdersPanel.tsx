/**
 * Painel de pedidos: as etapas da operacao em colunas, com o feed do dia ao lado.
 *
 * Difere da tela de Cozinha de proposito. A cozinha olha o que precisa ser
 * feito no fogao; este painel e o do balcao e do gerente, e por isso mostra
 * canal, pagamento, atraso e o historico do dia — informacao que atrapalharia
 * quem esta cozinhando.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Plus, RefreshCw, Search, Store, WifiOff } from 'lucide-react'
import { apiGet, apiPatch, errorMessage } from '../../lib/api'
import { useRealtime } from '../../hooks/useRealtime'
import { OrderCard } from './OrderCard'
import { ActivityFeed } from './ActivityFeed'
import type { ActivityEvent } from './activityTypes'
import {
  PANEL_COLUMNS,
  actionFor,
  canMove,
  requiredStepTitle,
  toPanelOrder,
  type OrderStatus,
  type PanelColumn,
  type PanelOrder,
} from './types'

interface Channel {
  id: string
  name: string
  slug: string
}

/** Abas de tipo de pedido, como no print. */
const TABS = [
  { id: 'todos', label: 'Todos', orderType: undefined },
  { id: 'balcao', label: 'Balcão', orderType: 'balcao' as const },
  { id: 'delivery', label: 'Delivery', orderType: 'delivery' as const },
  { id: 'mesa', label: 'Salão', orderType: 'mesa' as const },
]

function todayISO(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function OrdersPanel({ onNewOrder }: { onNewOrder?: () => void }) {
  const [orders, setOrders] = useState<PanelOrder[]>([])
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [feedLoading, setFeedLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [date, setDate] = useState(todayISO())
  const [tab, setTab] = useState('todos')
  const [channelId, setChannelId] = useState('')
  const [search, setSearch] = useState('')

  /** Pedido sendo movido pelo botao — desabilita so o cartao, nao a tela. */
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dragging, setDragging] = useState<PanelOrder | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  /**
   * Redesenha a cada 15s para os cronometros dos cartoes andarem. Sem isso o
   * "05:18" congela e o operador confia num tempo que nao e mais verdade.
   */
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 15000)
    return () => clearInterval(timer)
  }, [])

  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0]

  const loadOrders = useCallback(async () => {
    try {
      const params = new URLSearchParams({ date })
      if (activeTab?.orderType) params.set('orderType', activeTab.orderType)
      if (channelId) params.set('channelId', channelId)
      if (search.trim()) params.set('search', search.trim())

      const data = await apiGet<Record<string, unknown>[]>(`/api/orders?${params.toString()}`)
      setOrders(data.map(toPanelOrder))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível carregar os pedidos.'))
    } finally {
      setLoading(false)
    }
  }, [date, activeTab?.orderType, channelId, search])

  const loadFeed = useCallback(async () => {
    try {
      const data = await apiGet<ActivityEvent[]>(`/api/dashboard/activity?date=${date}&limit=40`)
      setEvents(data)
    } catch {
      // O feed e complemento: se ele falhar, as colunas continuam servindo.
    } finally {
      setFeedLoading(false)
    }
  }, [date])

  /**
   * Busca com atraso de 350 ms. Sem isso cada tecla digitada no campo dispara
   * uma consulta ao servidor, e as respostas voltam fora de ordem.
   */
  const searchRef = useRef(search)
  searchRef.current = search
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadOrders()
    }, 350)
    return () => clearTimeout(timer)
  }, [loadOrders])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  useEffect(() => {
    apiGet<Channel[]>('/api/dashboard/channels')
      .then(setChannels)
      .catch(() => setChannels([]))
  }, [])

  /** Tempo real: qualquer mudanca de pedido recarrega colunas e feed. */
  const refreshAll = useCallback(() => {
    void loadOrders()
    void loadFeed()
  }, [loadOrders, loadFeed])

  /**
   * `status` e exibido no cabecalho de proposito: um painel que perdeu a conexao
   * continua mostrando a fila antiga como se fosse a atual, e o balcao para de
   * ver pedidos novos sem perceber.
   */
  const { status: realtimeStatus } = useRealtime({
    handlers: {
      'order:created': refreshAll,
      'order:status': refreshAll,
      'order:cancelled': refreshAll,
    },
  })

  /** Move o pedido, com volta atras se o servidor recusar. */
  const advance = useCallback(
    async (order: PanelOrder, to: string) => {
      const target = to as OrderStatus
      if (!canMove(order.status, target)) {
        // O numero sai como "#1001" (antes ia entre aspas, parecendo texto
        // solto) e a frase diz o caminho: recusar sem apontar o proximo passo
        // deixa o operador adivinhando no meio do movimento.
        const step = requiredStepTitle(order.status)
        setNotice(
          step
            ? `O pedido #${order.orderNumber} precisa passar por ${step} antes.`
            : `O pedido #${order.orderNumber} não pode ir para essa etapa.`,
        )
        return
      }

      setBusyId(order.id)
      // Otimista: a coluna muda na hora. Numa cozinha o operador toca e ja olha
      // para o proximo pedido; esperar o servidor faria a tela parecer travada.
      const previous = orders
      setOrders((current) =>
        current.map((o) => (o.id === order.id ? { ...o, status: target } : o)),
      )

      try {
        await apiPatch(`/api/orders/${order.id}/status`, { status: target })
        void loadFeed()
      } catch (err) {
        setOrders(previous)
        setNotice(errorMessage(err, 'Não foi possível mover o pedido.'))
      } finally {
        setBusyId(null)
      }
    },
    [orders, loadFeed],
  )

  /** Agrupa os pedidos nas colunas uma unica vez por render. */
  const grouped = useMemo(() => {
    const map = new Map<string, PanelOrder[]>()
    for (const column of PANEL_COLUMNS) map.set(column.id, [])
    for (const order of orders) {
      const column = PANEL_COLUMNS.find((c) => c.statuses.includes(order.status))
      if (column) map.get(column.id)?.push(order)
    }
    // Mais antigo primeiro: quem esta esperando mais tempo aparece no topo.
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    }
    return map
  }, [orders])

  const totalToday = orders.length

  const handleDrop = useCallback(
    (column: PanelColumn) => {
      setDropTarget(null)
      const order = dragging
      setDragging(null)
      if (!order) return
      if (column.statuses.includes(order.status)) return

      const target = actionFor(column, order)
      // O status de destino do arraste e o `dropTo` da coluna; a excecao e
      // "Prontos" no balcao, onde a acao correta e entregar direto.
      const to = column.id === 'prontos' && order.orderType !== 'delivery' ? 'ready' : column.dropTo
      void advance(order, to === order.status ? (target?.to ?? to) : to)
    },
    [dragging, advance],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Cabecalho */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-plum">Pedidos</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate">
            {loading ? 'Carregando…' : `${totalToday} pedido${totalToday === 1 ? '' : 's'} nesta data`}
            {realtimeStatus !== 'connected' && (
              <span className="flex items-center gap-1 rounded-md bg-bad-soft px-2 py-0.5 text-xs font-semibold text-bad">
                <WifiOff aria-hidden="true" className="h-3.5 w-3.5" />
                {realtimeStatus === 'connecting' ? 'Conectando…' : 'Sem tempo real'}
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
            <Store aria-hidden="true" className="h-4 w-4 text-slate" />
            <span className="sr-only">Canal de venda</span>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="bg-transparent text-sm text-ink outline-none"
            >
              <option value="">Todos os canais</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
            <CalendarDays aria-hidden="true" className="h-4 w-4 text-slate" />
            <span className="sr-only">Data</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-sm tabular-nums text-ink outline-none"
            />
          </label>

          <button
            type="button"
            onClick={refreshAll}
            className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink hover:bg-canvas"
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Atualizar
          </button>

          {onNewOrder && (
            <button
              type="button"
              onClick={onNewOrder}
              className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-strong"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Novo pedido
            </button>
          )}
        </div>
      </header>

      {/* Abas + busca */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line">
        <nav aria-label="Tipo de pedido" className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                tab === t.id
                  ? 'border-brand font-semibold text-plum'
                  : 'border-transparent text-slate hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <label className="mb-2 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
          <Search aria-hidden="true" className="h-4 w-4 text-slate" />
          <span className="sr-only">Buscar pedidos, clientes, telefones</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar pedidos, clientes, telefones…"
            className="w-56 bg-transparent text-sm text-ink outline-none placeholder:text-slate"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad">
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn"
        >
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="font-semibold underline">
            Fechar
          </button>
        </p>
      )}

      {/**
       * Quadro e feed lado a lado so a partir de 1536px (`2xl`).
       *
       * Verificando em 1287px — a largura real do usuario — as quatro colunas
       * mais o feed de 20rem sobravam 170px por coluna: o nome do canal virava
       * "iF…", "Atrasado" virava "Atrasad" e "Enviar para rota" quebrava em tres
       * linhas. Abaixo de 1536px o feed vai para baixo do quadro, onde ganha a
       * largura inteira, e as colunas voltam a caber.
       */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 2xl:flex-row">
        {/* `min-w` por coluna + rolagem horizontal: em telas estreitas e melhor
            deslizar o quadro do que empilhar texto ilegivel dentro do cartao. */}
        <div className="grid min-h-0 flex-1 auto-cols-fr grid-flow-col gap-4 overflow-x-auto pb-1 [grid-auto-columns:minmax(15rem,1fr)]">
        {PANEL_COLUMNS.map((column) => {
          const list = grouped.get(column.id) ?? []
          const isTarget = dropTarget === column.id
          const rejects = dragging ? !canMove(dragging.status, column.dropTo) : false

          return (
            <section
              key={column.id}
              aria-label={column.title}
              onDragOver={(e) => {
                e.preventDefault()
                setDropTarget(column.id)
              }}
              onDragLeave={() => setDropTarget((current) => (current === column.id ? null : current))}
              onDrop={(e) => {
                e.preventDefault()
                handleDrop(column)
              }}
              className={`flex min-h-0 flex-col rounded-2xl border transition-colors ${
                isTarget && rejects
                  ? 'border-bad bg-bad-soft/40'
                  : isTarget
                    ? 'border-brand bg-brand-soft/40'
                    : 'border-line bg-canvas'
              }`}
            >
              <header
                className={`flex items-center justify-between gap-2 rounded-t-2xl px-4 py-3 ${column.headClass}`}
              >
                <h2 className="font-display text-base">{column.title}</h2>
                <span className="text-sm font-semibold tabular-nums">{list.length}</span>
              </header>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                {list.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    action={actionFor(column, order)}
                    accentClass={column.buttonClass}
                    busy={busyId === order.id}
                    onAdvance={advance}
                    onOpen={() => undefined}
                    onDragStart={setDragging}
                    onDragEnd={() => {
                      setDragging(null)
                      setDropTarget(null)
                    }}
                  />
                ))}

                {list.length === 0 && (
                  <p className="flex h-24 items-center justify-center rounded-xl border border-dashed border-line px-3 text-center text-xs text-slate">
                    Arraste pedidos para mover para outra etapa
                  </p>
                )}
              </div>
            </section>
          )
        })}
        </div>

        <ActivityFeed events={events} loading={feedLoading} />
      </div>
    </div>
  )
}
