import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChefHat, Clock3, Home, PackageCheck, ShoppingBag, Store, Truck, XCircle } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { apiGet, errorMessage } from '../lib/api'
import { DeliveryMap } from '../components/delivery/DeliveryMap'

interface Theme { primaryColor?: string; accentColor?: string; backgroundColor?: string; textColor?: string }
interface TrackedOrder {
  orderNumber: string; status: string; orderType: string; subtotal: number | string; deliveryFee: number | string
  totalAmount: number | string; paymentMethod: string; paymentStatus: string; deliveryAddress?: string | null
  createdAt: string; updatedAt: string
  delivery?: { status: string; estimatedTime?: string | null; estimatedArrivalAt?: string | null; pickedUpAt?: string | null; deliveryCode?: string | null; destinationLatitude?: number | null; destinationLongitude?: number | null; dispatchMode?: 'own_fleet' | 'external' | 'manual'; externalCourierName?: string | null; courier?: { name: string; vehicleType: string; currentLatitude?: number | null; currentLongitude?: number | null; locationUpdatedAt?: string | null } | null } | null
  tenant: { name: string; phone?: string | null; slug: string; logoData?: string | null; storefrontTheme?: Theme | null }
  orderItems: Array<{ quantity: number; unitPrice: number | string; subtotal: number | string; observations?: string | null; selectedProteinName?: string | null; addons?: unknown; product: { name: string; imageUrl?: string | null } }>
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const paymentLabels: Record<string, string> = { pix: 'Pix', cash: 'Dinheiro', credit: 'Cartão de crédito', debit: 'Cartão de débito' }
const steps = [
  { key: 'pending', label: 'Pedido recebido', detail: 'A loja recebeu seu pedido.', icon: ShoppingBag },
  { key: 'confirmed', label: 'Pedido confirmado', detail: 'Tudo certo para começar.', icon: Check },
  { key: 'preparing', label: 'Em preparo', detail: 'A cozinha está preparando.', icon: ChefHat },
  { key: 'ready', label: 'Pedido pronto', detail: 'Seu pedido já está embalado.', icon: PackageCheck },
  { key: 'dispatched', label: 'Saiu para entrega', detail: 'Está a caminho de você.', icon: Truck },
  { key: 'delivered', label: 'Entregue', detail: 'Bom apetite!', icon: Home },
]

export default function OrderTrackingPage() {
  const { token = '' } = useParams()
  const [order, setOrder] = useState<TrackedOrder | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setOrder(await apiGet<TrackedOrder>(`/api/public/orders/${encodeURIComponent(token)}`)); setError('') }
    catch (err) { setError(errorMessage(err, 'Pedido não encontrado.')) }
  }, [token])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 10_000)
    return () => window.clearInterval(timer)
  }, [load])

  const currentIndex = useMemo(() => steps.findIndex((step) => step.key === order?.status), [order?.status])
  const theme = { primaryColor: '#4A103A', accentColor: '#D9A629', backgroundColor: '#FFF8EE', textColor: '#251522', ...(order?.tenant.storefrontTheme ?? {}) }

  if (!order && !error) return <div className="grid min-h-screen place-items-center bg-[#fff8ee]"><div className="text-center"><Clock3 className="mx-auto h-9 w-9 animate-pulse text-[#4a103a]" /><p className="mt-3 text-sm">Localizando seu pedido...</p></div></div>
  if (error || !order) return <div className="grid min-h-screen place-items-center bg-[#fff8ee] p-6 text-center"><div><XCircle className="mx-auto h-10 w-10 text-red-600" /><h1 className="mt-4 text-xl font-bold">Não encontramos este pedido</h1><p className="mt-2 text-sm opacity-65">{error}</p></div></div>

  const cancelled = order.status === 'cancelled'

  return (
    <div className="min-h-screen px-4 py-6 sm:py-10" style={{ backgroundColor: theme.backgroundColor, color: theme.textColor }}>
      <main className="mx-auto max-w-3xl">
        <header className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-white shadow-sm">
            {order.tenant.logoData ? <img src={order.tenant.logoData} alt="" className="h-full w-full object-cover" /> : <Store className="h-6 w-6" style={{ color: theme.primaryColor }} />}
          </div>
          <div className="min-w-0"><p className="text-xs opacity-55">Acompanhamento em tempo real</p><h1 className="truncate text-lg font-extrabold" style={{ color: theme.primaryColor }}>{order.tenant.name}</h1></div>
        </header>

        <section className="mt-6 overflow-hidden rounded-[28px] bg-white shadow-xl ring-1 ring-black/5">
          <div className="p-6 text-white sm:p-8" style={{ backgroundColor: theme.primaryColor }}>
            <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-white/65">Pedido</p><h2 className="mt-1 text-3xl font-black">#{order.orderNumber}</h2><p className="mt-2 flex items-center gap-2 text-sm text-white/75"><Clock3 className="h-4 w-4" /> Feito às {new Date(order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p></div><span className="rounded-full px-4 py-2 text-xs font-extrabold" style={{ backgroundColor: theme.accentColor, color: theme.primaryColor }}>{cancelled ? 'Cancelado' : steps[Math.max(0, currentIndex)]?.label}</span></div>
          </div>

          {order.status === 'dispatched' && order.delivery?.estimatedArrivalAt && (
            <div className="border-b border-black/10 bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest opacity-50">Previsão atualizada</p><p className="mt-1 text-2xl font-black" style={{ color: theme.primaryColor }}>Chegada por volta de {new Date(order.delivery.estimatedArrivalAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</p><p className="mt-1 text-sm opacity-60">O horário muda automaticamente conforme o entregador avança.</p></div><Truck className="h-9 w-9" style={{ color: theme.accentColor }} /></div>
              {order.delivery.courier?.currentLatitude != null && order.delivery.courier.currentLongitude != null && order.delivery.destinationLatitude != null && order.delivery.destinationLongitude != null && <div className="mt-4 overflow-hidden rounded-2xl border border-black/10"><DeliveryMap current={{ latitude: order.delivery.courier.currentLatitude, longitude: order.delivery.courier.currentLongitude, label: 'Entregador' }} stops={[{ latitude: order.delivery.destinationLatitude, longitude: order.delivery.destinationLongitude, label: 'Sua entrega' }]} className="h-[280px]" /></div>}
            </div>
          )}

          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_280px]">
            <div>
              <h3 className="text-lg font-extrabold">Andamento</h3>
              {cancelled ? <div className="mt-5 flex gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700"><XCircle className="h-6 w-6 shrink-0" /><div><strong>Este pedido foi cancelado</strong><p className="mt-1 text-sm">Entre em contato com a loja se precisar de ajuda.</p></div></div> :
              <ol className="mt-5 space-y-0">{steps.map((step, index) => { const reached = index <= currentIndex; const active = index === currentIndex; const Icon = step.icon; return <li key={step.key} className="relative flex gap-4 pb-7 last:pb-0">{index < steps.length - 1 && <span className="absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-0.5" style={{ backgroundColor: index < currentIndex ? theme.primaryColor : '#e5e7eb' }} />}<span className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full border-2" style={{ borderColor: reached ? theme.primaryColor : '#e5e7eb', backgroundColor: reached ? theme.primaryColor : '#fff', color: reached ? '#fff' : '#9ca3af' }}><Icon className="h-4 w-4" /></span><div className={reached ? '' : 'opacity-40'}><p className="font-bold">{step.label}{active && <span className="ml-2 text-xs" style={{ color: theme.primaryColor }}>agora</span>}</p><p className="mt-0.5 text-sm opacity-60">{step.detail}</p></div></li> })}</ol>}
            </div>

            <aside className="rounded-2xl bg-black/[0.035] p-4">
              <h3 className="font-extrabold">Resumo do pedido</h3>
              <div className="mt-4 space-y-3">{order.orderItems.map((item, index) => <div key={`${item.product.name}-${index}`} className="flex justify-between gap-3 text-sm"><span><strong>{item.quantity}×</strong> {item.product.name}{item.selectedProteinName && <small className="block opacity-55">{item.selectedProteinName}</small>}</span><strong className="shrink-0">{money.format(Number(item.subtotal))}</strong></div>)}</div>
              <div className="mt-4 space-y-1 border-t border-black/10 pt-4 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money.format(Number(order.subtotal))}</span></div><div className="flex justify-between"><span>Entrega</span><span>{money.format(Number(order.deliveryFee))}</span></div><div className="flex justify-between pt-2 text-lg"><strong>Total</strong><strong>{money.format(Number(order.totalAmount))}</strong></div></div>
              <div className="mt-4 rounded-xl bg-white p-3 text-xs"><p className="font-bold">Pagamento: {paymentLabels[order.paymentMethod] ?? order.paymentMethod}</p><p className="mt-1 opacity-60">{order.paymentStatus === 'paid' ? 'Pagamento confirmado' : 'Aguardando confirmação da loja'}</p></div>
              {order.deliveryAddress && <div className="mt-3 text-xs"><p className="font-bold">Entregar em</p><p className="mt-1 opacity-60">{order.deliveryAddress}</p></div>}
              {order.delivery && (order.delivery.courier || order.delivery.externalCourierName || order.delivery.deliveryCode) && <div className="mt-3 rounded-xl border border-black/10 bg-white p-3 text-xs">{order.delivery.courier ? <><p className="font-bold">Entregador: {order.delivery.courier.name}</p><p className="mt-1 opacity-60">Veículo: {order.delivery.courier.vehicleType}</p></> : order.delivery.externalCourierName ? <><p className="font-bold">Entrega por parceiro</p><p className="mt-1 opacity-60">{order.delivery.externalCourierName}</p></> : <><p className="font-bold">Entrega organizada pela loja</p><p className="mt-1 opacity-60">Não é necessário cadastrar um entregador.</p></>}{order.delivery.deliveryCode && <div className="mt-3 rounded-lg p-3 text-center" style={{ backgroundColor: `${theme.accentColor}22` }}><p className="text-[10px] font-bold uppercase tracking-wider opacity-60">Código para confirmar a entrega</p><strong className="mt-1 block font-mono text-2xl tracking-[.3em]" style={{ color: theme.primaryColor }}>{order.delivery.deliveryCode}</strong><p className="mt-1 opacity-55">Informe somente quando receber o pedido.</p></div>}</div>}
            </aside>
          </div>
        </section>

        <div className="mt-5 flex justify-center"><Link to={`/loja/${order.tenant.slug}`} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold shadow-sm" style={{ color: theme.primaryColor }}><Store className="h-4 w-4" /> Voltar ao cardápio</Link></div>
      </main>
    </div>
  )
}
