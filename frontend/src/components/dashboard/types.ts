/**
 * Contrato de `GET /api/dashboard/overview`.
 *
 * Fica em arquivo proprio porque cinco componentes desta pasta leem pedacos do
 * mesmo payload: duplicar a interface em cada um deles faria a tela quebrar em
 * silencio quando o backend mudasse um campo, ja que cada copia estaria "certa"
 * segundo si mesma.
 */

/** Rotulos de status em portugues, do jeito que a operacao fala. */
export const STATUS_LABEL: Record<string, string> = {
  pending: 'Recebido',
  confirmed: 'Confirmado',
  preparing: 'Em preparo',
  ready: 'Pronto',
  dispatched: 'Saiu p/ entrega',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
}

/**
 * Cor de cada status. Verde e o fim feliz, dourado e producao, vinho e o comeco.
 * Nao ha azul nem roxo aqui: a paleta do sistema tem 3 famílias e o painel nao
 * inventa uma quarta so para ter mais um degrau de status.
 */
export const STATUS_TONE: Record<string, string> = {
  pending: 'bg-plum/10 text-plum',
  confirmed: 'bg-plum/10 text-plum',
  preparing: 'bg-warn-soft text-warn',
  ready: 'bg-good-soft text-good',
  dispatched: 'bg-brand-soft text-accent',
  delivered: 'bg-good-soft text-good',
  cancelled: 'bg-bad-soft text-bad',
}

export interface DaySummary {
  revenue: number
  orders: number
  averageTicket: number
  estimatedProfit: number
}

export interface HourPoint {
  hour: number
  revenue: number
  orders: number
}

export interface ChannelSlice {
  id: string
  name: string
  orders: number
  revenue: number
  share: number
}

export interface TopProduct {
  id: string
  name: string
  imageUrl: string | null
  quantity: number
}

export interface InProgressOrder {
  id: string
  orderNumber: string
  status: string
  orderType: string
  total: number
  paymentStatus: string
  channel: string
  customerName: string | null
  minutes: number
  createdAt: string
}

export interface OverviewAlerts {
  lowStock: {
    count: number
    items: { id: string; name: string; stock: number; minimumStock: number; unit: string }[]
  }
  lateOrders: { count: number; thresholdMinutes: number }
  lowMargin: {
    count: number
    thresholdPerc: number
    items: { id: string; name: string; marginPerc: number }[]
  }
}

export interface Overview {
  date: string
  kpis: { today: DaySummary; yesterday: DaySummary }
  hourly: HourPoint[]
  channels: ChannelSlice[]
  topProducts: TopProduct[]
  inProgress: InProgressOrder[]
  alerts: OverviewAlerts
}

/** Dinheiro em pt-BR. Centralizado para o painel nao misturar formatos. */
export function brl(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  })
}

/**
 * Variacao percentual entre dois periodos.
 *
 * Devolve `null` quando a base e zero, em vez de 0% ou de um "+100%" inventado:
 * loja que nao vendeu ontem nao tem com o que comparar, e mostrar "+100%" ali
 * seria informacao falsa num cartao que o dono usa para decidir o dia.
 */
export function variation(current: number, previous: number): number | null {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}
