/**
 * Tipos e regras do painel de pedidos.
 *
 * As colunas ficam aqui, e nao dentro do componente, porque as transicoes
 * precisam bater com `ALLOWED_TRANSITIONS` do backend. Quando as duas listas
 * divergem, o painel oferece um movimento que a API recusa, e o operador leva a
 * culpa por um erro nosso.
 */

/** Status de pedido, iguais aos do backend. */
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'dispatched'
  | 'delivered'
  | 'cancelled'

export type OrderType = 'delivery' | 'balcao' | 'mesa'

/** Item do pedido, achatado para o cartao. */
export interface PanelOrderItem {
  id: string
  name: string
  quantity: number
}

/** Pedido no formato que o painel consome. */
export interface PanelOrder {
  id: string
  orderNumber: string
  status: OrderStatus
  orderType: OrderType
  total: number
  paymentStatus: string
  paymentMethod: string
  createdAt: string
  observations: string | null
  customer: { id: string; name: string; phone: string | null; address: string | null } | null
  /** Nome do canal de venda (iFood, Salao...), quando o pedido tem um. */
  channel: string | null
  channelId: string | null
  items: PanelOrderItem[]
}

/** O que o botao da coluna faz. */
export interface StageAction {
  label: string
  to: OrderStatus
}

export interface PanelColumn {
  id: string
  title: string
  /** Status que caem nesta coluna. "Novos" junta pending e confirmed. */
  statuses: OrderStatus[]
  /** Status aplicado quando um cartao e SOLTO nesta coluna. */
  dropTo: OrderStatus
  action?: StageAction
  /** Classes da faixa do topo. */
  headClass: string
  /** Classes do botao de acao. */
  buttonClass: string
}

/**
 * As quatro colunas da operacao. `delivered` e `cancelled` nao viram coluna de
 * proposito: sao o fim da linha, e manter pedido entregue na tela empurraria as
 * colunas vivas para fora do campo de visao numa noite cheia.
 */
export const PANEL_COLUMNS: PanelColumn[] = [
  {
    id: 'novos',
    title: 'Novos',
    statuses: ['pending', 'confirmed'],
    dropTo: 'confirmed',
    action: { label: 'Aceitar', to: 'preparing' },
    headClass: 'bg-plum/5 text-plum',
    buttonClass: 'bg-plum text-cream hover:bg-plum-soft',
  },
  {
    id: 'preparo',
    title: 'Em preparo',
    statuses: ['preparing'],
    dropTo: 'preparing',
    action: { label: 'Marcar pronto', to: 'ready' },
    headClass: 'bg-warn-soft text-warn',
    buttonClass: 'border border-warn text-warn hover:bg-warn-soft',
  },
  {
    id: 'prontos',
    title: 'Prontos',
    statuses: ['ready'],
    dropTo: 'ready',
    action: { label: 'Enviar para rota', to: 'dispatched' },
    headClass: 'bg-good-soft text-good',
    buttonClass: 'border border-good text-good hover:bg-good-soft',
  },
  {
    id: 'rota',
    title: 'Em rota',
    statuses: ['dispatched'],
    dropTo: 'dispatched',
    action: { label: 'Entregar ao cliente', to: 'delivered' },
    headClass: 'bg-brand-soft text-accent',
    buttonClass: 'bg-brand text-brand-ink hover:bg-brand-strong',
  },
]

/**
 * Espelha `ALLOWED_TRANSITIONS` do backend. Usado para recusar um arraste ANTES
 * de chamar a API: soltar "Novos" em "Em rota" devolve o cartao na hora, em vez
 * de piscar na coluna errada e voltar quando o servidor responde 409.
 */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'preparing', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['dispatched', 'delivered', 'cancelled'],
  dispatched: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
}

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/** Nome da coluna onde um pedido nesta etapa aparece. */
export function columnTitleFor(status: OrderStatus): string | undefined {
  return PANEL_COLUMNS.find((column) => column.statuses.includes(status))?.title
}

/**
 * A coluna pela qual o pedido precisa passar antes de chegar aonde foi soltado.
 *
 * Serve para o aviso de arraste recusado dizer o caminho ("precisa passar por Em
 * preparo") em vez de so negar: recusar sem indicar o proximo passo obriga o
 * operador a adivinhar no meio do movimento. `cancelled` fica de fora porque
 * cancelar nunca e o caminho natural para frente.
 */
export function requiredStepTitle(from: OrderStatus): string | undefined {
  // A coluna atual e ignorada: `pending` pode virar `confirmed`, que vive na
  // MESMA coluna ("Novos"), e a primeira versao disso dizia a um pedido em Novos
  // que ele "precisa passar por Novos antes" — visto na tela. O passo util e a
  // proxima etapa que fica em outra coluna.
  const current = columnTitleFor(from)
  for (const next of ALLOWED_TRANSITIONS[from] ?? []) {
    if (next === 'cancelled') continue
    const title = columnTitleFor(next)
    if (title && title !== current) return title
  }
  return undefined
}

/**
 * "Prontos" aceita tanto `dispatched` quanto `delivered`: o mesmo cartao vira
 * "Enviar para rota" no delivery e "Entregar ao cliente" no balcao, porque
 * pedido de balcao nao entra em rota nenhuma.
 */
export function actionFor(column: PanelColumn, order: PanelOrder): StageAction | undefined {
  if (column.id === 'prontos' && order.orderType !== 'delivery') {
    return { label: 'Entregar ao cliente', to: 'delivered' }
  }
  return column.action
}

/** Minutos desde a criacao. */
export function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
}

/** Um pedido ativo passa a "atrasado" depois deste tempo. */
export const LATE_AFTER_MINUTES = 60

export function isLate(order: PanelOrder): boolean {
  return minutesSince(order.createdAt) >= LATE_AFTER_MINUTES
}

/**
 * Tempo na fila como `mm:ss` na primeira hora e `1h20` depois.
 *
 * O print mostra `05:18` para pedido recente: em cozinha o que importa e o
 * segundo, e nao a data. Passada uma hora, o segundo perde sentido e viraria
 * ruido (`72:41` nao se le de relance).
 */
export function elapsedLabel(iso: string): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (totalSeconds < 3600) {
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
    const ss = String(totalSeconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}h${String(minutes).padStart(2, '0')}`
}

export function brl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Achata a resposta da API no formato do cartao. */
export function toPanelOrder(raw: Record<string, unknown>): PanelOrder {
  const customer = raw.customer as
    | { id: string; name: string; phone: string | null; address: string | null }
    | null
  const channel = raw.salesChannel as { id: string; name: string } | null
  const items = Array.isArray(raw.orderItems) ? raw.orderItems : []

  return {
    id: String(raw.id),
    orderNumber: String(raw.orderNumber ?? ''),
    status: (raw.status as OrderStatus) ?? 'pending',
    orderType: (raw.orderType as OrderType) ?? 'balcao',
    total: Number(raw.totalAmount ?? 0),
    paymentStatus: String(raw.paymentStatus ?? 'pending'),
    paymentMethod: String(raw.paymentMethod ?? 'cash'),
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    observations: (raw.observations as string | null) ?? null,
    customer: customer ?? null,
    channel: channel?.name ?? null,
    channelId: channel?.id ?? null,
    items: items.map((item) => {
      const it = item as Record<string, unknown>
      const product = it.product as { name?: string } | null
      return {
        id: String(it.id),
        name: String(product?.name ?? it.productName ?? 'Item'),
        quantity: Number(it.quantity ?? 1),
      }
    }),
  }
}
