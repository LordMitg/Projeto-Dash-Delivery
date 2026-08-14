import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { Bike, CheckCircle2, Clock3, ExternalLink, ListOrdered, Loader2, LocateFixed, LogOut, MapPin, Navigation, Phone, QrCode, RefreshCw, Route, ScanLine, Trash2 } from 'lucide-react'
import type { BarcodeFormat } from 'barcode-detector/ponyfill'
import { CameraFeed } from '../components/scanner/CameraFeed'
import { DeliveryMap } from '../components/delivery/DeliveryMap'
import { apiDelete, apiPatch, apiPost, errorMessage, swrFetcher } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useRealtime } from '../hooks/useRealtime'

const QR_FORMATS: BarcodeFormat[] = ['qr_code']
interface Delivery {
  id: string; status: string; routePosition?: number | null; routeStartedAt?: string | null
  destinationLatitude?: number | null; destinationLongitude?: number | null; estimatedArrivalAt?: string | null
  order: { orderNumber: string; deliveryAddress?: string | null; observations?: string | null; publicToken?: string | null; customer?: { name: string; phone: string; address?: string | null } | null; orderItems: Array<{ quantity: number; observations?: string | null; product: { name: string } }> }
}
interface QueueData { profile: { name: string; vehicleType: string }; deliveries: Delivery[] }
interface RoutePlan { currentLocation: { latitude: number; longitude: number }; deliveries: Delivery[]; route: { distanceMeters: number; durationSeconds: number; geometry: [number, number][]; legs: Array<{ distance: number; duration: number; steps: Array<{ distance: number; duration: number; name: string; maneuver: { type: string; modifier?: string } }> }> } }

const km = (meters: number) => `${(meters / 1000).toFixed(1).replace('.', ',')} km`
const minutes = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} min`
const maneuverText = (step: RoutePlan['route']['legs'][number]['steps'][number]) => {
  const modifier: Record<string, string> = { left: 'à esquerda', right: 'à direita', straight: 'em frente', 'slight left': 'levemente à esquerda', 'slight right': 'levemente à direita', 'sharp left': 'forte à esquerda', 'sharp right': 'forte à direita', uturn: 'retorno' }
  if (step.maneuver.type === 'depart') return `Saia em direção a ${step.name || 'via principal'}`
  if (step.maneuver.type === 'arrive') return 'Você chegou ao destino'
  if (step.maneuver.type === 'roundabout') return `Entre na rotatória ${step.name ? `para ${step.name}` : ''}`
  return `Siga ${modifier[step.maneuver.modifier ?? 'straight'] ?? 'em frente'}${step.name ? ` em ${step.name}` : ''}`
}

export default function DriverDeliveryPage() {
  const { user, tenant, logout } = useAuth()
  const { data, error, isLoading, mutate } = useSWR<QueueData>('/api/driver/queue', swrFetcher, { refreshInterval: 20_000 })
  const [plan, setPlan] = useState<RoutePlan | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [busy, setBusy] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)
  const [resetToken, setResetToken] = useState(0)
  const lastLocationSent = useRef(0)
  const started = data?.deliveries.some((item) => item.status === 'in_transit') ?? false
  const currentStop = data?.deliveries.find((item) => item.status === 'in_transit') ?? null

  useRealtime({ handlers: { 'delivery:updated': () => void mutate() } })

  const getLocation = () => new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Este aparelho não fornece localização.'))
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 })
  })

  async function scan(code: string) {
    if (busy) return
    setBusy('scan'); setFeedback(null)
    try { await apiPost('/api/driver/scan', { code }); await mutate(); setScannerOpen(false); setManualCode(''); setResetToken((v) => v + 1); setFeedback({ kind: 'ok', text: 'Pedido adicionado à sua rota.' }) }
    catch (err) { setFeedback({ kind: 'bad', text: errorMessage(err, 'Não foi possível ler este pedido.') }); setResetToken((v) => v + 1) }
    finally { setBusy('') }
  }

  async function calculate(startRoute: boolean) {
    setBusy(startRoute ? 'start' : 'plan'); setFeedback(null)
    try {
      const position = await getLocation()
      const payload = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, heading: position.coords.heading ?? undefined }
      const result = await apiPost<RoutePlan>(startRoute ? '/api/driver/route/start' : '/api/driver/route/plan', payload)
      setPlan(result); await mutate()
      setFeedback({ kind: 'ok', text: startRoute ? 'Rota iniciada. Vá para a primeira parada.' : 'Melhor ordem das paradas calculada.' })
    } catch (err) { setFeedback({ kind: 'bad', text: errorMessage(err, 'Não foi possível calcular a rota.') }) }
    finally { setBusy('') }
  }

  useEffect(() => {
    if (!started || !navigator.geolocation) return
    const watch = navigator.geolocation.watchPosition((position) => {
      const now = Date.now()
      if (now - lastLocationSent.current < 20_000) return
      lastLocationSent.current = now
      const coords = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, heading: position.coords.heading ?? undefined }
      void apiPost<RoutePlan>('/api/driver/location', coords).then((next) => setPlan(next)).catch(() => undefined)
    }, () => setFeedback({ kind: 'bad', text: 'A localização foi interrompida. Ative o GPS para atualizar o tempo do cliente.' }), { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 })
    return () => navigator.geolocation.clearWatch(watch)
  }, [started])

  async function complete(delivery: Delivery) {
    if (!window.confirm(`Confirmar que o pedido #${delivery.order.orderNumber} foi entregue?`)) return
    setBusy(`complete-${delivery.id}`)
    try { await apiPatch(`/api/driver/${delivery.id}/complete`); setPlan(null); await mutate(); setFeedback({ kind: 'ok', text: 'Entrega concluída. A próxima parada já está liberada.' }) }
    catch (err) { setFeedback({ kind: 'bad', text: errorMessage(err, 'Não foi possível concluir a entrega.') }) }
    finally { setBusy('') }
  }

  const stops = useMemo(() => (plan?.deliveries ?? data?.deliveries ?? []).filter((d) => d.status !== 'delivered' && d.destinationLatitude != null && d.destinationLongitude != null).map((d, index) => ({ latitude: d.destinationLatitude!, longitude: d.destinationLongitude!, label: `${index + 1} · #${d.order.orderNumber}` })), [data?.deliveries, plan?.deliveries])
  const firstLeg = plan?.route.legs[0]

  if (isLoading) return <div className="grid min-h-screen place-items-center bg-[#fff8ee]"><Loader2 className="h-8 w-8 animate-spin text-[#4a103a]" /></div>
  return <div className="min-h-screen bg-[#fff8ee] text-[#251522]">
    <header className="sticky top-0 z-20 border-b border-black/10 bg-white/95 px-4 py-3 backdrop-blur"><div className="mx-auto flex max-w-5xl items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#4a103a] text-white"><Bike className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{tenant?.name}</p><p className="truncate text-xs opacity-60">{user?.firstName} · Área do entregador</p></div><button onClick={logout} className="rounded-xl border border-black/10 p-3" aria-label="Sair"><LogOut className="h-4 w-4" /></button></div></header>
    <main className="mx-auto max-w-5xl space-y-4 p-4 pb-28">
      {feedback && <p role="alert" className={`rounded-2xl border p-3 text-sm font-semibold ${feedback.kind === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{feedback.text}</p>}
      {error && <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{errorMessage(error, 'Não foi possível carregar sua rota.')}</p>}

      <section className="rounded-[24px] bg-[#4a103a] p-5 text-white shadow-lg"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-white/60">Sua saída</p><h1 className="mt-1 text-2xl font-black">{started ? 'Rota em andamento' : `${data?.deliveries.length ?? 0} pedido(s) na pilha`}</h1><p className="mt-1 text-sm text-white/70">{started ? 'O cliente recebe seu tempo estimado automaticamente.' : 'Leia os QR Codes e monte a melhor sequência.'}</p></div><Route className="h-8 w-8 text-[#f2bd39]" /></div>{plan && <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-white/10 p-3"><p className="text-xs text-white/60">Percurso</p><strong>{km(plan.route.distanceMeters)}</strong></div><div className="rounded-xl bg-white/10 p-3"><p className="text-xs text-white/60">Tempo previsto</p><strong>{minutes(plan.route.durationSeconds)}</strong></div></div>}</section>

      {!started && <section className="rounded-[24px] border border-black/10 bg-white p-4 shadow-sm"><button onClick={() => setScannerOpen((v) => !v)} className="flex w-full items-center gap-3 text-left"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#f9e8af]"><QrCode className="h-6 w-6 text-[#4a103a]" /></span><span className="flex-1"><strong className="block">Ler QR Code do pedido</strong><small className="opacity-60">Você pode adicionar vários antes de sair</small></span><ScanLine className="h-5 w-5" /></button>{scannerOpen && <div className="mt-4 space-y-3 border-t border-black/10 pt-4"><CameraFeed formats={QR_FORMATS} onDetect={(value) => void scan(value)} resetToken={resetToken} guide="square" hint="Enquadre o QR Code do pedido" /><form onSubmit={(e: FormEvent) => { e.preventDefault(); void scan(manualCode) }} className="flex gap-2"><input value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="Ou cole o código para testar" className="min-w-0 flex-1 rounded-xl border border-black/10 px-3 py-2 text-sm"/><button disabled={!manualCode || Boolean(busy)} className="rounded-xl bg-[#4a103a] px-4 text-sm font-bold text-white">Adicionar</button></form></div>}</section>}

      {(plan || started) && stops.length > 0 && <section className="overflow-hidden rounded-[24px] border border-black/10 bg-white shadow-sm"><DeliveryMap current={plan ? { ...plan.currentLocation, label: 'Você' } : null} stops={stops} geometry={plan?.route.geometry} className="h-[390px]" /><div className="flex items-center justify-between gap-3 p-4"><div><strong className="block">Rota em tempo real</strong><small className="opacity-60">Atualiza conforme você se desloca</small></div>{currentStop?.destinationLatitude && <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${currentStop.destinationLatitude},${currentStop.destinationLongitude}`} className="inline-flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-xs font-bold">Abrir no Maps <ExternalLink className="h-3.5 w-3.5" /></a>}</div></section>}

      {firstLeg && started && <section className="rounded-[24px] border border-black/10 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 text-lg font-black"><Navigation className="h-5 w-5 text-[#d9a629]"/>Próximas instruções</h2><ol className="mt-3 space-y-2">{firstLeg.steps.filter((s) => s.distance > 5 || s.maneuver.type === 'arrive').slice(0, 5).map((step, index) => <li key={`${step.name}-${index}`} className="flex gap-3 rounded-xl bg-black/[.035] p-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#4a103a] text-xs font-bold text-white">{index + 1}</span><div><p className="text-sm font-bold">{maneuverText(step)}</p><p className="text-xs opacity-55">{step.distance < 1000 ? `${Math.round(step.distance)} m` : km(step.distance)}</p></div></li>)}</ol></section>}

      <section className="rounded-[24px] border border-black/10 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 text-lg font-black"><ListOrdered className="h-5 w-5"/>Ordem das entregas</h2><div className="mt-3 space-y-3">{(data?.deliveries ?? []).length === 0 ? <div className="rounded-2xl border border-dashed border-black/15 p-8 text-center text-sm opacity-55">Sua pilha está vazia. Leia o QR Code de um pedido pronto.</div> : data?.deliveries.map((delivery, index) => <article key={delivery.id} className={`rounded-2xl border p-4 ${delivery.id === currentStop?.id ? 'border-[#d9a629] bg-[#fff8df]' : 'border-black/10'}`}><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#4a103a] font-black text-white">{delivery.routePosition ?? index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>#{delivery.order.orderNumber} · {delivery.order.customer?.name}</strong>{delivery.id === currentStop?.id && <span className="rounded-full bg-[#d9a629] px-2 py-0.5 text-[10px] font-black">AGORA</span>}</div><p className="mt-1 flex gap-1.5 text-sm opacity-65"><MapPin className="mt-0.5 h-4 w-4 shrink-0"/>{delivery.order.deliveryAddress}</p>{delivery.order.customer?.phone && <a href={`tel:${delivery.order.customer.phone}`} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#4a103a]"><Phone className="h-3.5 w-3.5"/>{delivery.order.customer.phone}</a>}<p className="mt-2 text-xs opacity-60">{delivery.order.orderItems.map((item) => `${item.quantity}× ${item.product.name}`).join(' · ')}</p>{delivery.estimatedArrivalAt && <p className="mt-2 flex items-center gap-1 text-xs font-bold text-green-700"><Clock3 className="h-3.5 w-3.5"/>Previsão {new Date(delivery.estimatedArrivalAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</p>}</div>{!started && <button onClick={() => void apiDelete(`/api/driver/${delivery.id}`).then(() => mutate())} className="p-2 text-red-600" aria-label="Remover da pilha"><Trash2 className="h-4 w-4"/></button>}</div>{delivery.id === currentStop?.id && <button disabled={Boolean(busy)} onClick={() => void complete(delivery)} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-green-600 font-black text-white"><CheckCircle2 className="h-5 w-5"/>Marcar como entregue</button>}</article>)}</div></section>
    </main>
    {(data?.deliveries.length ?? 0) > 0 && <div className="fixed inset-x-0 bottom-0 z-20 border-t border-black/10 bg-white/95 p-3 backdrop-blur"><div className="mx-auto flex max-w-5xl gap-2">{!started && <button disabled={Boolean(busy)} onClick={() => void calculate(false)} className="flex h-13 flex-1 items-center justify-center gap-2 rounded-2xl border border-[#4a103a] font-black text-[#4a103a]">{busy==='plan'?<Loader2 className="h-5 w-5 animate-spin"/>:<RefreshCw className="h-5 w-5"/>}Calcular</button>}<button disabled={Boolean(busy)} onClick={() => void calculate(!started)} className="flex h-13 flex-[1.4] items-center justify-center gap-2 rounded-2xl bg-[#d9a629] px-4 font-black text-[#4a103a]">{busy?<Loader2 className="h-5 w-5 animate-spin"/>:started?<LocateFixed className="h-5 w-5"/>:<Navigation className="h-5 w-5"/>}{started?'Atualizar rota':'Iniciar rota'}</button></div></div>}
  </div>
}
