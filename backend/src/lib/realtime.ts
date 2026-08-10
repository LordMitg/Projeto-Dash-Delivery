/**
 * Ponte de eventos em tempo real (Socket.IO).
 *
 * As rotas nao importam o servidor Socket.IO diretamente: isso criaria
 * dependencia circular entre `index.ts` e as rotas. Em vez disso, o
 * `index.ts` registra a instancia aqui, e as rotas apenas publicam eventos.
 *
 * Se o Socket.IO nao estiver ativo (ex: rodando testes), `emitToTenant`
 * simplesmente nao faz nada — nunca quebra a requisicao.
 */
import type { Server } from 'socket.io'

let io: Server | null = null

export function setRealtimeServer(server: Server) {
  io = server
}

/** Nome da sala de uma loja. Cada loja so recebe os proprios eventos. */
export function tenantRoom(tenantId: string) {
  return `tenant:${tenantId}`
}

export type RealtimeEvent =
  | 'order:created'
  | 'order:status'
  | 'order:cancelled'
  | 'store:status'
  | 'stock:low'
  // Caixa: o PDV escuta para liberar ou bloquear a venda na hora, sem o
  // operador precisar recarregar a tela quando o gerente abre ou fecha o turno.
  | 'cash:opened'
  | 'cash:entry'
  | 'cash:closed'

/** Publica um evento para todos os dispositivos daquela loja. */
export function emitToTenant(tenantId: string, event: RealtimeEvent, payload: unknown) {
  if (!io) return
  io.to(tenantRoom(tenantId)).emit(event, payload)
}
