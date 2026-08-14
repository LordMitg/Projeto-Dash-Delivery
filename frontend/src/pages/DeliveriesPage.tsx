import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import QRCode from 'qrcode'
import useSWR from 'swr'
import {
  AlertTriangle,
  Bike,
  CheckCircle2,
  Clock3,
  Loader2,
  MapPin,
  Navigation,
  PackageCheck,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  Route,
  Truck,
  UserCheck,
  Users,
  WifiOff,
  X,
} from 'lucide-react'
import { apiGet, apiPatch, apiPost, errorMessage, swrFetcher } from '../lib/api'
import { useRealtime } from '../hooks/useRealtime'
import { DeliveryMap } from '../components/delivery/DeliveryMap'

interface Courier {
  id: string
  name: string
  phone?: string | null
  vehicleType: string
  plate?: string | null
  availability: 'available' | 'busy' | 'offline'
  deliveryFee: number | string
  currentLatitude?: number | null
  currentLongitude?: number | null
}

interface Delivery {
  id: string
  status: 'pending' | 'awaiting_assignment' | 'assigned' | 'in_transit' | 'delivered' | 'failed'
  assignedAt?: string | null
  pickedUpAt?: string | null
  actualTime?: string | null
  deliveryCode?: string | null
  recipientName?: string | null
  proofNotes?: string | null
  destinationLatitude?: number | null
  destinationLongitude?: number | null
  estimatedArrivalAt?: string | null
  dispatchMode?: 'own_fleet' | 'external' | 'manual'
  externalCourierName?: string | null
  courier?: Courier | null
  order: {
    id: string
    orderNumber: string
    status: string
    totalAmount: number | string
    deliveryFee: number | string
    deliveryAddress?: string | null
    createdAt: string
    customer?: {
      name: string
      phone?: string | null
      address?: string | null
      neighborhood?: string | null
      city?: string | null
    } | null
    orderItems: Array<{ id: string; quantity: number; observations?: string | null; product: { name: string } }>
  }
}

interface Board {
  summary: { waiting: number; inTransit: number; deliveredToday: number; available: number; totalCouriers: number }
  deliveries: Delivery[]
  couriers: Courier[]
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const fieldClass = 'h-11 rounded-lg border border-line bg-canvas px-3 text-sm text-ink outline-none focus:border-brand'

function shortNumber(value: string) {
  const part = value.split('-').at(-1) || value
  return part.replace(/^0+/, '') || '0'
}

function elapsed(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`
}

function statusLabel(delivery: Delivery) {
  if (delivery.status === 'pending' || delivery.order.status !== 'ready' && delivery.status === 'awaiting_assignment') return 'Em produção'
  if (delivery.status === 'awaiting_assignment') return 'Aguardando entregador'
  if (delivery.status === 'assigned') return 'Aguardando retirada'
  if (delivery.status === 'in_transit') return 'Em rota'
  if (delivery.status === 'delivered') return 'Entregue'
  return 'Precisa de atenção'
}

export default function DeliveriesPage() {
  const { data, error, isLoading, mutate } = useSWR<Board>('/api/deliveries/board', swrFetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  })
  const refresh = useCallback(() => void mutate(), [mutate])
  const { status: realtimeStatus } = useRealtime({ handlers: { 'delivery:updated': refresh, 'order:status': refresh, 'order:created': refresh } })
  const [courierModal, setCourierModal] = useState(false)
  const [proofTarget, setProofTarget] = useState<Delivery | null>(null)
  const [qrTarget, setQrTarget] = useState<Delivery | null>(null)
  const [selectedCouriers, setSelectedCouriers] = useState<Record<string, string>>({})
  const [dispatchModes, setDispatchModes] = useState<Record<string, 'own_fleet' | 'external' | 'manual'>>({})
  const [externalNames, setExternalNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')

  const waiting = useMemo(() => data?.deliveries.filter((item) => ['pending', 'awaiting_assignment', 'assigned', 'failed'].includes(item.status)) ?? [], [data])
  const routes = useMemo(() => data?.deliveries.filter((item) => item.status === 'in_transit') ?? [], [data])
  const completed = useMemo(() => data?.deliveries.filter((item) => item.status === 'delivered') ?? [], [data])
  const availableCouriers = data?.couriers.filter((item) => item.availability === 'available') ?? []

  async function act(key: string, request: () => Promise<unknown>) {
    setBusy(key)
    setActionError('')
    try {
      await request()
      await mutate()
    } catch (err) {
      setActionError(errorMessage(err, 'Não foi possível atualizar a entrega.'))
    } finally {
      setBusy(null)
    }
  }

  async function assign(delivery: Delivery) {
    const dispatchMode = dispatchModes[delivery.id] || 'own_fleet'
    const courierId = selectedCouriers[delivery.id]
    const externalCourierName = externalNames[delivery.id]?.trim()
    if (dispatchMode === 'own_fleet' && !courierId) {
      setActionError('Escolha um entregador disponível.')
      return
    }
    if (dispatchMode === 'external' && !externalCourierName) {
      setActionError('Informe o app ou nome do entregador avulso.')
      return
    }
    const payload = dispatchMode === 'own_fleet'
      ? { dispatchMode, courierId }
      : dispatchMode === 'external'
        ? { dispatchMode, externalCourierName }
        : { dispatchMode }
    await act(`assign-${delivery.id}`, () => apiPatch(`/api/deliveries/${delivery.id}/assign`, payload))
  }

  return (
    <section aria-labelledby="deliveries-title" className="space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 id="deliveries-title" className="font-display text-4xl text-plum">Entregas</h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${realtimeStatus === 'connected' ? 'bg-good-soft text-good' : 'bg-warn-soft text-warn'}`}>
              {realtimeStatus === 'connected' ? <span className="h-1.5 w-1.5 rounded-full bg-good" /> : <WifiOff className="h-3 w-3" />}
              {realtimeStatus === 'connected' ? 'Ao vivo' : 'Reconectando'}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate">Despacho, entregadores e confirmação de recebimento em um só fluxo</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void mutate()} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink"><RefreshCw className="h-4 w-4" />Atualizar</button>
          <button type="button" onClick={() => setCourierModal(true)} className="inline-flex h-11 items-center gap-2 rounded-lg bg-plum px-4 text-sm font-semibold text-cream"><Plus className="h-4 w-4" />Novo entregador</button>
        </div>
      </header>

      {(error || actionError) && <div role="alert" className="flex items-center gap-2 rounded-lg border border-bad/20 bg-bad-soft px-4 py-3 text-sm text-bad"><AlertTriangle className="h-4 w-4 shrink-0" />{actionError || 'Não foi possível carregar a central de entregas.'}</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Summary icon={PackageCheck} label="Na expedição" value={data?.summary.waiting ?? 0} detail="produção, fila e retirada" tone="plum" />
        <Summary icon={Bike} label="Em rota" value={data?.summary.inTransit ?? 0} detail="a caminho dos clientes" tone="brand" />
        <Summary icon={UserCheck} label="Disponíveis" value={data?.summary.available ?? 0} detail={`de ${data?.summary.totalCouriers ?? 0} entregadores`} tone="good" />
        <Summary icon={CheckCircle2} label="Entregues hoje" value={data?.summary.deliveredToday ?? 0} detail="com confirmação" tone="blue" />
      </div>

      {isLoading ? <div className="flex min-h-80 items-center justify-center gap-2 rounded-card border border-line bg-surface text-sm text-slate"><Loader2 className="h-5 w-5 animate-spin" />Carregando expedição...</div> : (
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.15fr)_minmax(390px,.85fr)]">
          <div className="space-y-5">
            <OperationalMap routes={routes} waiting={waiting} />
            <CourierStrip couriers={data?.couriers ?? []} onToggle={(courier) => void act(`courier-${courier.id}`, () => apiPatch(`/api/deliveries/couriers/${courier.id}`, { availability: courier.availability === 'offline' ? 'available' : 'offline' }))} busy={busy} />
          </div>

          <div className="space-y-5">
            <Panel title="Fila de expedição" count={waiting.length} helper="Prontos aparecem aqui após a liberação da cozinha">
              {waiting.length === 0 ? <Empty text="Nenhum pedido aguardando despacho." /> : waiting.map((delivery) => (
                <DeliveryCard key={delivery.id} delivery={delivery}>
                  {delivery.status === 'pending' || delivery.order.status !== 'ready' ? (
                    <div className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-xs font-semibold text-accent"><Clock3 className="h-3.5 w-3.5" />A cozinha ainda está preparando este pedido</div>
                  ) : delivery.status === 'assigned' ? (
                    <div className="flex gap-2">
                      <button type="button" disabled={busy !== null} onClick={() => void act(`pickup-${delivery.id}`, () => apiPatch(`/api/deliveries/${delivery.id}/pickup`))} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-plum px-3 text-sm font-bold text-cream disabled:opacity-50"><Navigation className="h-4 w-4" />Confirmar saída</button>
                      <button type="button" disabled={busy !== null} onClick={() => void act(`unassign-${delivery.id}`, () => apiPatch(`/api/deliveries/${delivery.id}/unassign`))} className="h-10 rounded-lg border border-line px-3 text-xs font-semibold text-slate disabled:opacity-50">Trocar</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button type="button" onClick={() => setQrTarget(delivery)} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-plum px-4 text-sm font-bold text-cream"><QrCode className="h-4 w-4" />Exibir QR para o entregador</button>
                      <p className="text-center text-[11px] text-slate">Ou despache manualmente:</p>
                      <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface p-1 text-[11px] font-bold">
                        {([['own_fleet', 'Frota própria'], ['external', 'App/avulso'], ['manual', 'Sem cadastro']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setDispatchModes((current) => ({ ...current, [delivery.id]: value }))} className={`rounded-md px-2 py-2 ${(dispatchModes[delivery.id] || 'own_fleet') === value ? 'bg-plum text-cream' : 'text-slate'}`}>{label}</button>)}
                      </div>
                      <div className="flex gap-2">
                        {(dispatchModes[delivery.id] || 'own_fleet') === 'own_fleet' && <select aria-label={`Entregador do pedido ${shortNumber(delivery.order.orderNumber)}`} value={selectedCouriers[delivery.id] || ''} onChange={(event) => setSelectedCouriers((current) => ({ ...current, [delivery.id]: event.target.value }))} className={`${fieldClass} min-w-0 flex-1`}><option value="">Escolha o entregador</option>{availableCouriers.map((courier) => <option key={courier.id} value={courier.id}>{courier.name} · {courier.vehicleType}</option>)}</select>}
                        {dispatchModes[delivery.id] === 'external' && <input aria-label="App ou entregador avulso" placeholder="Ex.: iFood Entrega ou João" value={externalNames[delivery.id] || ''} onChange={(event) => setExternalNames((current) => ({ ...current, [delivery.id]: event.target.value }))} className={`${fieldClass} min-w-0 flex-1`} />}
                        {dispatchModes[delivery.id] === 'manual' && <p className="flex min-h-11 flex-1 items-center rounded-lg bg-surface px-3 text-xs text-slate">Avance sem vincular entregador.</p>}
                        <button type="button" disabled={busy !== null} onClick={() => void assign(delivery)} className="h-11 rounded-lg bg-brand px-4 text-sm font-bold text-brand-ink disabled:opacity-50">Preparar saída</button>
                      </div>
                    </div>
                  )}
                </DeliveryCard>
              ))}
            </Panel>

            <Panel title="Em rota" count={routes.length} helper="Saídas confirmadas pelo operador">
              {routes.length === 0 ? <Empty text="Nenhuma rota em andamento." /> : routes.map((delivery) => <DeliveryCard key={delivery.id} delivery={delivery}><button type="button" onClick={() => setProofTarget(delivery)} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-good px-3 text-sm font-bold text-white"><CheckCircle2 className="h-4 w-4" />Confirmar entrega</button></DeliveryCard>)}
            </Panel>

            {completed.length > 0 && <Panel title="Concluídas hoje" count={completed.length} helper="Recebimentos já confirmados"><div className="divide-y divide-line">{completed.slice(0, 8).map((delivery) => <div key={delivery.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><span className="grid h-9 w-9 place-items-center rounded-full bg-good-soft text-good"><CheckCircle2 className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-ink">#{shortNumber(delivery.order.orderNumber)} · {delivery.order.customer?.name}</p><p className="truncate text-xs text-slate">{delivery.courier?.name} · recebido por {delivery.recipientName}</p></div><time className="text-xs font-semibold text-slate">{delivery.actualTime ? new Date(delivery.actualTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}</time></div>)}</div></Panel>}
          </div>
        </div>
      )}

      {courierModal && <CourierDialog onClose={() => setCourierModal(false)} onSaved={async () => { setCourierModal(false); await mutate() }} />}
      {proofTarget && <ProofDialog delivery={proofTarget} onClose={() => setProofTarget(null)} onSaved={async () => { setProofTarget(null); await mutate() }} />}
      {qrTarget && <PickupQrDialog delivery={qrTarget} onClose={() => setQrTarget(null)} />}
    </section>
  )
}

function PickupQrDialog({ delivery, onClose }: { delivery: Delivery; onClose: () => void }) {
  const [image, setImage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    void apiGet<{ payload: string }>(`/api/deliveries/${delivery.id}/pickup-code`)
      .then((data) => QRCode.toDataURL(data.payload, { width: 420, margin: 2, color: { dark: '#4A103A', light: '#FFFFFF' } }))
      .then(setImage)
      .catch((err) => setError(errorMessage(err, 'Não foi possível gerar o QR Code.')))
  }, [delivery.id])
  return <div className="fixed inset-0 z-50 grid place-items-center bg-plum/70 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-card bg-white p-5 text-center shadow-xl"><div className="flex items-start justify-between text-left"><div><h2 className="font-display text-2xl text-plum">Retirada #{shortNumber(delivery.order.orderNumber)}</h2><p className="text-sm text-slate">O entregador lê este código na área dele.</p></div><button onClick={onClose} aria-label="Fechar"><X className="h-5 w-5" /></button></div>{error ? <p className="mt-5 rounded-lg bg-bad-soft p-3 text-sm text-bad">{error}</p> : image ? <img src={image} alt={`QR Code do pedido ${delivery.order.orderNumber}`} className="mx-auto mt-5 w-full max-w-[340px]" /> : <Loader2 className="mx-auto mt-12 h-8 w-8 animate-spin text-plum" />}<p className="mt-3 text-xs text-slate">O código identifica somente este pedido e só funciona para um entregador autenticado desta loja.</p><div className="mt-5 flex gap-2"><button onClick={() => window.print()} className="h-11 flex-1 rounded-lg border border-line font-semibold text-plum">Imprimir</button><button onClick={onClose} className="h-11 flex-1 rounded-lg bg-plum font-semibold text-cream">Concluído</button></div></div></div>
}

function Summary({ icon: Icon, label, value, detail, tone }: { icon: typeof Truck; label: string; value: number; detail: string; tone: 'plum' | 'brand' | 'good' | 'blue' }) {
  const colors = { plum: 'bg-plum text-cream', brand: 'bg-brand-soft text-accent', good: 'bg-good-soft text-good', blue: 'bg-blue-50 text-blue-700' }
  return <article className="flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-sm"><span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${colors[tone]}`}><Icon className="h-5 w-5" /></span><div><p className="text-xs font-semibold text-slate">{label}</p><strong className="text-2xl text-ink">{value}</strong><p className="text-[11px] text-slate">{detail}</p></div></article>
}

function OperationalMap({ routes, waiting }: { routes: Delivery[]; waiting: Delivery[] }) {
  const plotted = [...routes, ...waiting.filter((item) => item.order.status === 'ready')].slice(0, 6)
  const stops = plotted.filter((item) => item.destinationLatitude != null && item.destinationLongitude != null).map((item) => ({ latitude: item.destinationLatitude!, longitude: item.destinationLongitude!, label: `#${shortNumber(item.order.orderNumber)}` }))
  const active = routes.find((item) => item.courier?.currentLatitude != null && item.courier.currentLongitude != null)
  const driver = active?.courier ? { latitude: active.courier.currentLatitude!, longitude: active.courier.currentLongitude!, label: active.courier.name } : null
  return <section className="overflow-hidden rounded-card border border-line bg-surface shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><div><h2 className="flex items-center gap-2 font-display text-2xl text-plum"><Route className="h-5 w-5" />Visão das rotas</h2><p className="text-xs text-slate">GPS e paradas atualizados em tempo real</p></div><span className="rounded-full bg-canvas px-3 py-1 text-xs font-semibold text-slate">{routes.length} em rota</span></div>{stops.length || driver ? <DeliveryMap current={driver} stops={stops} className="h-[390px]" /> : <div className="grid min-h-[390px] place-items-center bg-[#f7f2ea] p-8 text-center text-sm text-slate">As paradas aparecerão no mapa assim que o entregador calcular a rota.</div>}</section>
}

function CourierStrip({ couriers, onToggle, busy }: { couriers: Courier[]; onToggle: (courier: Courier) => void; busy: string | null }) {
  return <section className="rounded-card border border-line bg-surface p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-display text-2xl text-plum">Entregadores</h2><p className="text-xs text-slate">Disponibilidade da frota própria</p></div><Users className="h-5 w-5 text-accent" /></div>{couriers.length === 0 ? <Empty text="Cadastre o primeiro entregador para começar." /> : <div className="grid gap-2 sm:grid-cols-2">{couriers.map((courier) => <article key={courier.id} className="flex items-center gap-3 rounded-xl border border-line p-3"><span className={`grid h-10 w-10 place-items-center rounded-full ${courier.availability === 'available' ? 'bg-good-soft text-good' : courier.availability === 'busy' ? 'bg-brand-soft text-accent' : 'bg-canvas text-slate'}`}><Bike className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-ink">{courier.name}</p><p className="truncate text-xs text-slate">{courier.vehicleType}{courier.plate ? ` · ${courier.plate}` : ''}</p></div><button type="button" onClick={() => onToggle(courier)} disabled={courier.availability === 'busy' || busy !== null} className={`rounded-full px-2.5 py-1 text-[10px] font-bold disabled:cursor-not-allowed ${courier.availability === 'available' ? 'bg-good-soft text-good' : courier.availability === 'busy' ? 'bg-brand-soft text-accent' : 'bg-canvas text-slate'}`}>{courier.availability === 'available' ? 'Disponível' : courier.availability === 'busy' ? 'Em entrega' : 'Offline'}</button></article>)}</div>}</section>
}

function Panel({ title, count, helper, children }: { title: string; count: number; helper: string; children: React.ReactNode }) {
  return <section className="rounded-card border border-line bg-surface p-4 shadow-sm"><header className="mb-4 flex items-start gap-3"><div><h2 className="font-display text-2xl text-plum">{title}</h2><p className="text-xs text-slate">{helper}</p></div><span className="ml-auto grid h-8 min-w-8 place-items-center rounded-full bg-brand px-2 text-sm font-bold text-brand-ink">{count}</span></header><div className="space-y-3">{children}</div></section>
}

function DeliveryCard({ delivery, children }: { delivery: Delivery; children: React.ReactNode }) {
  const dispatchLabel = delivery.courier ? `${delivery.courier.name} · ${delivery.courier.vehicleType}` : delivery.externalCourierName ? `Terceiro · ${delivery.externalCourierName}` : delivery.status === 'assigned' || delivery.status === 'in_transit' ? 'Sem entregador cadastrado' : null
  return <article className="rounded-xl border border-line bg-canvas/40 p-4"><div className="flex items-start gap-3"><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${delivery.status === 'in_transit' ? 'bg-plum text-cream' : delivery.status === 'assigned' ? 'bg-brand-soft text-accent' : 'bg-surface text-plum'}`}><Truck className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="font-display text-xl text-plum">#{shortNumber(delivery.order.orderNumber)}</strong><span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-slate">{statusLabel(delivery)}</span><span className="ml-auto text-xs font-semibold text-slate">{elapsed(delivery.order.createdAt)}</span></div><p className="mt-1 truncate text-sm font-bold text-ink">{delivery.order.customer?.name || 'Cliente'}</p><p className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-slate"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{delivery.order.deliveryAddress || delivery.order.customer?.address || 'Endereço não informado'}</p>{delivery.order.customer?.phone && <a href={`tel:${delivery.order.customer.phone}`} className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-plum"><Phone className="h-3.5 w-3.5" />{delivery.order.customer.phone}</a>}<p className="mt-2 text-xs text-slate">{delivery.order.orderItems.map((item) => `${item.quantity}× ${item.product.name}`).join(' · ')}</p>{dispatchLabel && <div className="mt-3 flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-xs"><span><strong>{dispatchLabel}</strong></span>{delivery.deliveryCode && <span className="font-mono font-bold text-plum">cód. {delivery.deliveryCode}</span>}</div>}</div></div><div className="mt-3">{children}</div></article>
}

function Empty({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-slate">{text}</div> }

function CourierDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ name: '', phone: '', vehicleType: 'moto', plate: '', deliveryFee: '0' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(''); try { await apiPost('/api/deliveries/couriers', { ...form, deliveryFee: Number(form.deliveryFee) }); await onSaved() } catch (err) { setError(errorMessage(err, 'Não foi possível cadastrar.')); setSaving(false) } }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-plum/60 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="w-full max-w-lg rounded-card border border-line bg-surface p-5 shadow-xl"><div className="flex items-start justify-between"><div><h2 className="font-display text-2xl text-plum">Novo entregador</h2><p className="mt-1 text-sm text-slate">Cadastro operacional, sem criar acesso administrativo.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X className="h-5 w-5 text-slate" /></button></div>{error && <p className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}<div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="flex flex-col gap-1.5 text-sm font-semibold text-ink sm:col-span-2">Nome<input autoFocus required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={fieldClass} /></label><label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">Telefone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={fieldClass} /></label><label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">Veículo<select value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })} className={fieldClass}><option value="moto">Moto</option><option value="carro">Carro</option><option value="bicicleta">Bicicleta</option><option value="a_pe">A pé</option></select></label><label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">Placa<input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} className={fieldClass} /></label><label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">Taxa por entrega<input type="number" min="0" step="0.01" value={form.deliveryFee} onChange={(e) => setForm({ ...form, deliveryFee: e.target.value })} className={fieldClass} /></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="h-10 rounded-lg border border-line px-4 text-sm font-semibold text-slate">Cancelar</button><button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-plum px-4 text-sm font-semibold text-cream disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Cadastrar</button></div></form></div>
}

function ProofDialog({ delivery, onClose, onSaved }: { delivery: Delivery; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ deliveryCode: '', recipientName: delivery.order.customer?.name || '', proofNotes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); setError(''); try { await apiPatch(`/api/deliveries/${delivery.id}/complete`, form); await onSaved() } catch (err) { setError(errorMessage(err, 'Não foi possível concluir.')); setSaving(false) } }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-plum/60 p-4" role="dialog" aria-modal="true"><form onSubmit={submit} className="w-full max-w-lg rounded-card border border-line bg-surface p-5 shadow-xl"><div className="flex items-start justify-between"><div><h2 className="font-display text-2xl text-plum">Confirmar entrega #{shortNumber(delivery.order.orderNumber)}</h2><p className="mt-1 text-sm text-slate">Confira o código mostrado no acompanhamento do cliente.</p></div><button type="button" onClick={onClose} aria-label="Fechar"><X className="h-5 w-5 text-slate" /></button></div>{error && <p className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}<div className="mt-5 space-y-4"><label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">Código de 4 dígitos<input autoFocus required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={form.deliveryCode} onChange={(e) => setForm({ ...form, deliveryCode: e.target.value.replace(/\D/g, '').slice(0, 4) })} className={`${fieldClass} font-mono text-lg tracking-[.35em]`} /></label><label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">Quem recebeu<input required minLength={2} value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} className={fieldClass} /></label><label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">Observação do comprovante<textarea rows={3} maxLength={300} value={form.proofNotes} onChange={(e) => setForm({ ...form, proofNotes: e.target.value })} placeholder="Ex.: entregue na portaria" className="rounded-lg border border-line bg-canvas p-3 text-sm outline-none focus:border-brand" /></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="h-10 rounded-lg border border-line px-4 text-sm font-semibold text-slate">Cancelar</button><button disabled={saving || form.deliveryCode.length !== 4} className="inline-flex h-10 items-center gap-2 rounded-lg bg-good px-4 text-sm font-semibold text-white disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Confirmar recebimento</button></div></form></div>
}
