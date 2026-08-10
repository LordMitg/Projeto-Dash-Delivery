/**
 * Conexao Socket.IO com o backend (tempo real do KDS).
 *
 * O backend em `lib/realtime.ts` publica eventos na sala da loja
 * (`tenant:<id>`), e o handshake exige o JWT — quem nao prova quem e nao entra
 * na sala, entao um restaurante nunca ve os pedidos de outro.
 *
 * Duas decisoes importantes aqui:
 *
 * 1. **Socket compartilhado.** A instancia vive no modulo, nao no hook. Se cada
 *    componente abrisse a sua, a tela da cozinha com 3 paineis manteria 3
 *    conexoes e o servidor contaria 3 dispositivos por atendente.
 *
 * 2. **O estado de conexao e exposto.** Uma tela de cozinha que perde a conexao
 *    em silencio e pior do que uma tela que nao existe: ela mostra pedidos
 *    velhos como se fossem a fila atual, e a cozinha para de produzir sem saber.
 *    Por isso `status` sai do hook e a UI e obrigada a exibi-lo.
 */
import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { getToken } from '../lib/api'

/**
 * Eventos que o backend publica (espelha `RealtimeEvent` do servidor).
 *
 * E uma CONSTANTE, nao apenas um tipo, porque o efeito de conexao precisa
 * percorrer a lista para registrar um listener por evento. Antes a lista estava
 * escrita a mao dentro do efeito, separada do tipo: quem adicionava um evento
 * novo atualizava o tipo, o TypeScript aceitava o handler, e o listener
 * simplesmente nunca era registrado — uma falha silenciosa. Derivando o tipo da
 * constante, esquecer um evento passa a ser impossivel.
 */
export const REALTIME_EVENTS = [
  'order:created',
  'order:status',
  'order:cancelled',
  'store:status',
  'stock:low',
  'cash:opened',
  'cash:entry',
  'cash:closed',
] as const

export type RealtimeEvent = (typeof REALTIME_EVENTS)[number]

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected'

let socket: Socket | null = null
let refCount = 0

/**
 * O Vite faz proxy de `/socket.io` para o backend, entao a origem padrao serve
 * tanto em dev quanto em producao — sem `localhost:3001` cravado, que quebrava
 * o acesso pelo celular na rede local.
 */
function getSocket(): Socket {
  if (socket) return socket
  socket = io({
    path: '/socket.io',
    // `auth` e reavaliado a cada tentativa de reconexao: se o token foi
    // renovado no meio da sessao, a reconexao usa o novo em vez de insistir
    // com um expirado e ficar fora da sala para sempre.
    auth: (cb: (data: { token: string | null }) => void) => cb({ token: getToken() }),
    transports: ['websocket', 'polling'],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  })
  return socket
}

export interface UseRealtimeOptions {
  /** Mapa evento -> tratador. Trocar de handler nao reconecta o socket. */
  handlers?: Partial<Record<RealtimeEvent, (payload: unknown) => void>>
  /** Permite desligar em telas que nao precisam (ex: relatorios). */
  enabled?: boolean
}

export function useRealtime({ handlers, enabled = true }: UseRealtimeOptions = {}) {
  const [status, setStatus] = useState<RealtimeStatus>('connecting')

  // Os handlers ficam numa ref para que o efeito de conexao dependa apenas de
  // `enabled`. Sem isso, cada render recriaria o objeto de handlers, o efeito
  // rodaria de novo e o socket entraria em ciclo de conectar/desconectar.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!enabled) return

    const s = getSocket()
    refCount += 1

    const onConnect = () => setStatus('connected')
    const onDisconnect = () => setStatus('disconnected')
    const onError = () => setStatus('disconnected')

    s.on('connect', onConnect)
    s.on('disconnect', onDisconnect)
    s.on('connect_error', onError)

    // Se o socket ja estava conectado quando esta tela montou, o evento
    // `connect` nao vai disparar novamente — sincroniza o estado na hora.
    setStatus(s.connected ? 'connected' : 'connecting')
    if (!s.connected) s.connect()

    // Um unico listener por evento, que consulta a ref na hora da chamada.
    const bound = REALTIME_EVENTS.map((event) => {
      const fn = (payload: unknown) => handlersRef.current?.[event]?.(payload)
      s.on(event, fn)
      return [event, fn] as const
    })

    return () => {
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
      s.off('connect_error', onError)
      bound.forEach(([event, fn]) => s.off(event, fn))

      // Só derruba a conexao quando a ultima tela que a usava desmonta.
      // Desconectar sempre faria o socket cair ao navegar entre duas telas que
      // ambas dependem dele.
      refCount -= 1
      if (refCount === 0) {
        s.disconnect()
        socket = null
      }
    }
  }, [enabled])

  return { status }
}

/** Fecha a conexao no logout: a sessao seguinte precisa de um token novo. */
export function closeRealtime() {
  if (!socket) return
  socket.disconnect()
  socket = null
  refCount = 0
}
