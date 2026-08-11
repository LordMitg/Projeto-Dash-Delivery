/** Uma linha do feed de Atualizacoes, como o backend devolve. */
export interface ActivityEvent {
  id: string
  /** created | status | cancelled */
  type: string
  fromStatus: string | null
  toStatus: string | null
  /** Motivo do cancelamento, ou o tipo do pedido quando `type` e `created`. */
  note: string | null
  createdAt: string
  orderId: string
  orderNumber: string
  /** Cliente, ou canal quando o pedido nao tem cliente cadastrado. */
  subject: string
  actor: string | null
}
