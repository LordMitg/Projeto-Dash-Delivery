import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import {
  AlertTriangle,
  Bell,
  BellOff,
  Check,
  ChefHat,
  Clock3,
  Expand,
  Loader2,
  PackageCheck,
  Play,
  Printer,
  RefreshCw,
  RotateCcw,
  Star,
  WifiOff,
} from 'lucide-react'
import { apiPatch, errorMessage, swrFetcher } from '../lib/api'
import { useRealtime } from '../hooks/useRealtime'
import { usePrinter } from '../hooks/usePrinter'

type ProductionStatus = 'pending' | 'preparing' | 'ready'

interface FrozenAddon {
  addonId: string
  name: string
  quantity: number
}

interface OrderItem {
  id: string
  quantity: number
  productionStatus: ProductionStatus
  preparationStation: string
  preparationTimeMinutes: number
  startedAt?: string | null
  readyAt?: string | null
  printedAt?: string | null
  observations?: string | null
  selectedProteinName?: string | null
  addons?: FrozenAddon[] | null
  product?: { id: string; name: string; imageUrl?: string | null } | null
}

interface KitchenOrder {
  id: string
  orderNumber: string
  status: string
  orderType: 'delivery' | 'balcao' | 'mesa'
  observations?: string | null
  createdAt: string
  customer?: { name?: string | null } | null
  priority: boolean
  priorityReason?: string | null
  orderItems: OrderItem[]
}

type ActionDialog =
  | { kind: 'priority'; order: KitchenOrder }
  | { kind: 'reopen'; order: KitchenOrder; item: OrderItem }

const COLUMNS: Array<{ key: ProductionStatus; label: string; helper: string }> = [
  { key: 'pending', label: 'A preparar', helper: 'Aguardando início' },
  { key: 'preparing', label: 'Preparando', helper: 'Em produção agora' },
  { key: 'ready', label: 'Pronto', helper: 'Aguardando expedição' },
]

const TYPE_LABEL: Record<KitchenOrder['orderType'], string> = {
  delivery: 'Entrega',
  balcao: 'Retirada',
  mesa: 'No local',
}

function elapsedMinutes(start: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(start).getTime()) / 60_000))
}

function shortOrderNumber(value: string) {
  const lastPart = value.split('-').at(-1) || value
  return lastPart.replace(/^0+(?=\d)/, '')
}

function timerFor(item: OrderItem, order: KitchenOrder, now: number) {
  const start = item.startedAt || order.createdAt
  const elapsed = elapsedMinutes(start, now)
  const remaining = item.preparationTimeMinutes - elapsed
  if (item.productionStatus === 'ready' && item.readyAt) {
    const duration = elapsedMinutes(item.startedAt || order.createdAt, new Date(item.readyAt).getTime())
    return { label: `${duration} min`, late: duration > item.preparationTimeMinutes }
  }
  return remaining >= 0
    ? { label: `${remaining} min`, late: false }
    : { label: `${Math.abs(remaining)} min atrasado`, late: true }
}

export function KitchenDisplay() {
  const { printKitchen } = usePrinter()
  const { data: orders, isLoading, mutate } = useSWR<KitchenOrder[]>('/api/kitchen/orders', swrFetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })
  const [station, setStation] = useState('Todos')
  const [moving, setMoving] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [sound, setSound] = useState(false)
  const [autoPrint, setAutoPrint] = useState(() => localStorage.getItem('delione_kds_auto_print') === 'true')
  const [pendingAutoPrintOrderId, setPendingAutoPrintOrderId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ActionDialog | null>(null)
  const [reason, setReason] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const previousPending = useRef(0)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const refresh = useCallback(() => void mutate(), [mutate])
  const { status: realtimeStatus } = useRealtime({
    handlers: {
      'order:created': (payload) => {
        const id = (payload as { id?: string } | null)?.id
        if (autoPrint && station !== 'Todos' && id) setPendingAutoPrintOrderId(id)
        refresh()
      },
      'order:status': refresh,
      'order:item-status': refresh,
      'order:priority': refresh,
      'order:kitchen-printed': refresh,
      'order:cancelled': refresh,
    },
  })

  const stations = useMemo(
    () => ['Todos', ...Array.from(new Set((orders ?? []).flatMap((order) => order.orderItems.map((item) => item.preparationStation)))).sort()],
    [orders],
  )

  const visibleOrders = useMemo(() =>
    (orders ?? []).map((order) => ({
      ...order,
      visibleItems: order.orderItems.filter((item) => station === 'Todos' || item.preparationStation === station),
    })), [orders, station])

  const pendingCount = useMemo(
    () => visibleOrders.reduce((sum, order) => sum + order.visibleItems.filter((item) => item.productionStatus === 'pending').length, 0),
    [visibleOrders],
  )

  useEffect(() => {
    if (sound && pendingCount > previousPending.current && previousPending.current > 0) {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioContextClass) {
        const context = new AudioContextClass()
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.frequency.value = 880
        gain.gain.value = 0.08
        oscillator.start()
        oscillator.stop(context.currentTime + 0.18)
      }
    }
    previousPending.current = pendingCount
  }, [pendingCount, sound])

  const lateCount = useMemo(() =>
    visibleOrders.reduce((sum, order) => sum + order.visibleItems.filter((item) =>
      item.productionStatus !== 'ready' && timerFor(item, order, now).late,
    ).length, 0), [now, visibleOrders])

  const readyDurations = useMemo(() => visibleOrders.flatMap((order) =>
    order.visibleItems.filter((item) => item.readyAt).map((item) =>
      elapsedMinutes(item.startedAt || order.createdAt, new Date(item.readyAt!).getTime()),
    )), [visibleOrders])
  const averageMinutes = readyDurations.length
    ? Math.round(readyDurations.reduce((sum, value) => sum + value, 0) / readyDurations.length)
    : 0

  async function printStation(order: KitchenOrder, stationName: string) {
    const items = order.orderItems.filter((item) => item.preparationStation === stationName)
    if (!items.length) return
    setMoving(`print-${order.id}-${stationName}`)
    setActionError(null)
    try {
      const result = await printKitchen({
        orderNumber: shortOrderNumber(order.orderNumber),
        orderType: order.orderType,
        station: stationName,
        priority: order.priority,
        priorityReason: order.priorityReason || undefined,
        observations: order.observations || undefined,
        createdAt: order.createdAt,
        items: items.map((item) => ({
          productName: item.product?.name || 'Item',
          quantity: item.quantity,
          observations: item.observations || undefined,
          selectedProteinName: item.selectedProteinName || undefined,
          addons: Array.isArray(item.addons)
            ? item.addons.map((addon) => ({ name: addon.name, quantity: addon.quantity }))
            : undefined,
        })),
      })
      if (!result.success) throw new Error(result.error || 'A impressão não foi concluída.')
      await apiPatch(`/api/kitchen/orders/${order.id}/print`, { station: stationName })
      await mutate()
    } catch (err) {
      setActionError(errorMessage(err, 'Não foi possível imprimir a comanda.'))
    } finally {
      setMoving(null)
    }
  }

  useEffect(() => {
    if (!pendingAutoPrintOrderId || station === 'Todos' || !orders) return
    const order = orders.find((entry) => entry.id === pendingAutoPrintOrderId)
    if (!order) return
    const hasUnprinted = order.orderItems.some((item) => item.preparationStation === station && !item.printedAt)
    setPendingAutoPrintOrderId(null)
    if (hasUnprinted) void printStation(order, station)
  }, [orders, pendingAutoPrintOrderId, station])

  function toggleAutoPrint() {
    const next = !autoPrint
    setAutoPrint(next)
    localStorage.setItem('delione_kds_auto_print', String(next))
  }

  async function togglePriority(order: KitchenOrder) {
    if (!order.priority) {
      setReason('')
      setDialog({ kind: 'priority', order })
      return
    }
    setMoving(order.id)
    try {
      await apiPatch(`/api/kitchen/orders/${order.id}/priority`, { priority: false })
      await mutate()
    } catch (err) {
      setActionError(errorMessage(err, 'Não foi possível remover a prioridade.'))
    } finally {
      setMoving(null)
    }
  }

  async function confirmReasonAction() {
    if (!dialog || reason.trim().length < 3) return
    const key = dialog.kind === 'priority' ? dialog.order.id : dialog.item.id
    setMoving(key)
    setActionError(null)
    try {
      if (dialog.kind === 'priority') {
        await apiPatch(`/api/kitchen/orders/${dialog.order.id}/priority`, { priority: true, reason: reason.trim() })
      } else {
        await apiPatch(`/api/kitchen/orders/${dialog.order.id}/items/${dialog.item.id}/reopen`, { reason: reason.trim() })
      }
      setDialog(null)
      setReason('')
      await mutate()
    } catch (err) {
      setActionError(errorMessage(err, 'Não foi possível concluir a ação.'))
    } finally {
      setMoving(null)
    }
  }

  async function moveItem(orderId: string, itemId: string, status: 'preparing' | 'ready') {
    setMoving(itemId)
    setActionError(null)
    try {
      await apiPatch(`/api/kitchen/orders/${orderId}/items/${itemId}/status`, { status })
      await mutate()
    } catch (err) {
      setActionError(errorMessage(err, 'Não foi possível atualizar este item.'))
    } finally {
      setMoving(null)
    }
  }

  async function dispatch(order: KitchenOrder) {
    setMoving(order.id)
    setActionError(null)
    try {
      await apiPatch(`/api/kitchen/orders/${order.id}/dispatch`)
      await mutate()
    } catch (err) {
      setActionError(errorMessage(err, 'Não foi possível liberar o pedido.'))
    } finally {
      setMoving(null)
    }
  }

  return (
    <section aria-labelledby="kds-title" className="flex min-h-[calc(100vh-9rem)] flex-col gap-4">
      <header className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-sm xl:flex-row xl:items-center">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-accent"><ChefHat className="h-6 w-6" /></span>
          <div>
            <div className="flex items-center gap-3">
              <h2 id="kds-title" className="font-display text-3xl text-plum">Cozinha</h2>
              <span className="font-mono text-lg font-semibold text-ink">{new Date(now).toLocaleTimeString('pt-BR')}</span>
            </div>
            <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${realtimeStatus === 'connected' ? 'bg-good-soft text-good' : 'bg-warn-soft text-warn'}`}>
              {realtimeStatus === 'connected' ? <span className="h-1.5 w-1.5 rounded-full bg-good" /> : <WifiOff className="h-3 w-3" />}
              {realtimeStatus === 'connected' ? 'Ao vivo' : 'Reconectando'}
            </span>
          </div>
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-2 xl:justify-center">
          <span className="mr-1 text-xs font-semibold tracking-wide text-slate uppercase">Estações</span>
          {stations.map((name) => <button key={name} type="button" onClick={() => setStation(name)} className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${station === name ? 'border-plum bg-plum text-cream' : 'border-line bg-canvas text-ink hover:border-brand'}`}>{name}</button>)}
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleAutoPrint} disabled={station === 'Todos'} title={station === 'Todos' ? 'Escolha uma estação para ativar a impressão automática.' : `Imprimir automaticamente pedidos novos de ${station}`} className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${autoPrint && station !== 'Todos' ? 'border-good bg-good-soft text-good' : 'border-line text-slate'}`}><Printer className="h-4 w-4" />Auto</button>
          <button type="button" onClick={() => setSound((value) => !value)} className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${sound ? 'border-brand bg-brand-soft text-accent' : 'border-line text-slate'}`}>{sound ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}Som</button>
          <button type="button" onClick={() => void document.documentElement.requestFullscreen?.()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold text-ink"><Expand className="h-4 w-4" />Tela cheia</button>
          <button type="button" onClick={refresh} aria-label="Atualizar fila" className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-slate hover:text-ink"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </header>

      {(realtimeStatus === 'disconnected' || actionError) && <div role="alert" className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn"><AlertTriangle className="h-4 w-4" />{actionError || 'A conexão ao vivo caiu. A fila continua sendo recarregada automaticamente.'}</div>}

      {isLoading ? <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate"><Loader2 className="h-5 w-5 animate-spin" />Carregando a produção...</div> : (
        <div className="grid flex-1 gap-4 xl:grid-cols-3">
          {COLUMNS.map((column) => {
            const columnOrders = visibleOrders.filter((order) => order.visibleItems.some((item) => item.productionStatus === column.key))
            const itemCount = columnOrders.reduce((sum, order) => sum + order.visibleItems.filter((item) => item.productionStatus === column.key).length, 0)
            return <div key={column.key} className="flex min-w-0 flex-col rounded-card border border-line bg-canvas/70 p-3">
              <div className="mb-3 flex items-center gap-3 rounded-xl bg-plum px-4 py-3 text-cream">
                <div><h3 className="font-display text-xl">{column.label}</h3><p className="text-xs text-cream/70">{column.helper}</p></div>
                <span className="ml-auto flex h-8 min-w-8 items-center justify-center rounded-full bg-brand px-2 font-bold text-plum">{itemCount}</span>
              </div>

              <div className="flex flex-col gap-3">
                {!columnOrders.length && <div className="rounded-xl border border-dashed border-line bg-surface px-4 py-10 text-center text-sm text-slate">Nenhum item nesta etapa</div>}
                {columnOrders.map((order) => {
                  const items = order.visibleItems.filter((item) => item.productionStatus === column.key)
                  const allReady = order.orderItems.every((item) => item.productionStatus === 'ready')
                  return <article key={`${column.key}-${order.id}`} className={`overflow-hidden rounded-xl border bg-surface shadow-sm ${order.priority ? 'border-brand ring-2 ring-brand/30' : items.some((item) => timerFor(item, order, now).late) ? 'border-bad/60' : 'border-line'}`}>
                    <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                      <strong className="font-display text-2xl text-plum">#{shortOrderNumber(order.orderNumber)}</strong>
                      {order.priority && <span className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-xs font-bold text-plum"><Star className="h-3 w-3 fill-current" />Prioridade</span>}
                      <span className="rounded-md bg-brand-soft px-2 py-1 text-xs font-semibold text-accent">{TYPE_LABEL[order.orderType]}</span>
                      <span className="ml-auto text-right text-xs text-slate"><strong className="block text-sm text-ink">{order.customer?.name || 'Cliente balcão'}</strong>{new Date(order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-canvas/60 px-3 py-2">
                      <button type="button" onClick={() => void togglePriority(order)} disabled={moving === order.id} className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold ${order.priority ? 'border-brand bg-brand-soft text-accent' : 'border-line bg-surface text-slate'}`}><Star className={`h-3.5 w-3.5 ${order.priority ? 'fill-current' : ''}`} />{order.priority ? 'Remover prioridade' : 'Priorizar'}</button>
                      {Array.from(new Set(items.map((item) => item.preparationStation))).map((stationName) => {
                        const stationItems = order.orderItems.filter((item) => item.preparationStation === stationName)
                        const printed = stationItems.length > 0 && stationItems.every((item) => item.printedAt)
                        const printKey = `print-${order.id}-${stationName}`
                        return <button key={stationName} type="button" onClick={() => void printStation(order, stationName)} disabled={moving === printKey} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-xs font-semibold text-slate hover:text-ink"><Printer className="h-3.5 w-3.5" />{moving === printKey ? 'Imprimindo...' : printed ? `Reimprimir ${stationName}` : `Imprimir ${stationName}`}</button>
                      })}
                    </div>
                    {order.priorityReason && <p className="border-b border-brand/20 bg-brand-soft px-4 py-2 text-xs font-semibold text-accent">Motivo: {order.priorityReason}</p>}

                    <div className="divide-y divide-line">
                      {items.map((item) => {
                        const timer = timerFor(item, order, now)
                        const next = item.productionStatus === 'pending' ? 'preparing' : item.productionStatus === 'preparing' ? 'ready' : null
                        return <div key={item.id} className="p-4">
                          <div className="flex items-start gap-3">
                            {item.product?.imageUrl ? <img src={item.product.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-canvas text-plum"><PackageCheck className="h-5 w-5" /></span>}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-2"><p className="font-semibold leading-snug text-ink"><span className="mr-1 text-lg text-plum">{item.quantity}×</span>{item.product?.name || 'Item'}</p><span className={`ml-auto shrink-0 rounded-md px-2 py-1 text-xs font-bold ${timer.late ? 'bg-bad-soft text-bad' : item.productionStatus === 'ready' ? 'bg-good-soft text-good' : 'bg-brand-soft text-accent'}`}>{timer.label}</span></div>
                              <p className="mt-1 text-xs font-semibold text-slate">{item.preparationStation} · meta {item.preparationTimeMinutes} min</p>
                              {item.selectedProteinName && <p className="mt-1 text-xs text-slate">Opção: {item.selectedProteinName}</p>}
                              {Array.isArray(item.addons) && item.addons.length > 0 && <p className="mt-1 text-xs text-slate">{item.addons.map((addon) => `${addon.quantity}× ${addon.name}`).join(' · ')}</p>}
                              {item.observations && <p className="mt-2 rounded-md bg-warn-soft px-2 py-1.5 text-xs font-semibold text-warn">Obs.: {item.observations}</p>}
                            </div>
                          </div>
                          {next && <button type="button" disabled={moving === item.id} onClick={() => void moveItem(order.id, item.id, next)} className={`mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-60 ${next === 'preparing' ? 'bg-brand text-plum hover:bg-brand/85' : 'border border-brand bg-brand-soft text-accent hover:bg-brand/20'}`}>{moving === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : next === 'preparing' ? <Play className="h-4 w-4" /> : <Check className="h-4 w-4" />}{moving === item.id ? 'Atualizando...' : next === 'preparing' ? 'Iniciar preparo' : 'Marcar como pronto'}</button>}
                          {item.productionStatus === 'ready' && <button type="button" onClick={() => { setReason(''); setDialog({ kind: 'reopen', order, item }) }} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-line text-xs font-semibold text-slate hover:border-warn hover:text-warn"><RotateCcw className="h-3.5 w-3.5" />Reabrir item</button>}
                        </div>
                      })}
                    </div>

                    {order.observations && <p className="mx-4 mb-3 rounded-md bg-warn-soft px-2 py-1.5 text-xs font-semibold text-warn">Pedido: {order.observations}</p>}
                    {column.key === 'ready' && <div className="border-t border-line p-3">{allReady ? <button type="button" disabled={moving === order.id} onClick={() => void dispatch(order)} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-good text-sm font-bold text-white disabled:opacity-60"><PackageCheck className="h-4 w-4" />{moving === order.id ? 'Liberando...' : order.orderType === 'delivery' ? 'Enviar para expedição' : 'Entregar ao cliente'}</button> : <p className="text-center text-xs font-semibold text-slate">Aguardando itens de outras estações</p>}</div>}
                  </article>
                })}
              </div>
            </div>
          })}
        </div>
      )}

      <footer className="grid gap-3 rounded-card border border-line bg-surface p-3 shadow-sm sm:grid-cols-3">
        <div className="flex items-center justify-center gap-3 rounded-xl bg-canvas px-4 py-3"><Clock3 className="h-8 w-8 text-plum" /><div><p className="text-xs text-slate">Tempo médio concluído</p><strong className="text-xl text-ink">{averageMinutes || '—'}{averageMinutes ? ' min' : ''}</strong></div></div>
        <div className="flex items-center justify-center gap-3 rounded-xl bg-canvas px-4 py-3"><ChefHat className="h-8 w-8 text-accent" /><div><p className="text-xs text-slate">Itens na fila</p><strong className="text-xl text-ink">{pendingCount}</strong></div></div>
        <div className="flex items-center justify-center gap-3 rounded-xl bg-canvas px-4 py-3"><AlertTriangle className="h-8 w-8 text-bad" /><div><p className="text-xs text-slate">Atrasados</p><strong className="text-xl text-bad">{lateCount}</strong></div></div>
      </footer>

      {dialog && <div className="fixed inset-0 z-50 flex items-center justify-center bg-plum/55 p-4" role="dialog" aria-modal="true" aria-labelledby="kds-action-title">
        <div className="w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-xl">
          <h3 id="kds-action-title" className="font-display text-2xl text-plum">{dialog.kind === 'priority' ? `Priorizar pedido #${shortOrderNumber(dialog.order.orderNumber)}` : `Reabrir ${dialog.item.product?.name || 'item'}`}</h3>
          <p className="mt-2 text-sm text-slate">{dialog.kind === 'priority' ? 'Informe por que este pedido deve passar à frente. Isso ficará no histórico.' : 'Explique o que precisa ser corrigido. O pedido voltará automaticamente para preparação.'}</p>
          <label className="mt-4 flex flex-col gap-1.5 text-sm font-semibold text-ink">Motivo<textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={200} placeholder={dialog.kind === 'priority' ? 'Ex.: cliente aguardando há muito tempo' : 'Ex.: ponto incorreto, precisa refazer'} className="rounded-lg border border-line bg-canvas p-3 text-sm outline-none focus:border-brand" /></label>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="h-10 rounded-lg border border-line px-4 text-sm font-semibold text-slate">Cancelar</button><button type="button" onClick={() => void confirmReasonAction()} disabled={reason.trim().length < 3 || moving !== null} className="h-10 rounded-lg bg-plum px-4 text-sm font-semibold text-cream disabled:opacity-50">Confirmar</button></div>
        </div>
      </div>}
    </section>
  )
}

export default KitchenDisplay
