import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios'

/**
 * Cliente HTTP unico da aplicacao.
 *
 * Antes desta correcao cada componente montava sua propria chamada, alguns com
 * `http://localhost:3001` fixo no codigo (o que quebra ao abrir pelo celular,
 * porque para o celular "localhost" e o proprio celular) e outros mandando
 * apenas o header `x-tenant-id`, sem o JWT — esses recebiam 401 sempre.
 *
 * Aqui o token e injetado em UM lugar, e a URL base sai de variavel de
 * ambiente, com fallback para caminho relativo (que o proxy do Vite resolve).
 */

const TOKEN_KEY = 'delivery_erp_token'
const USER_KEY = 'delivery_erp_user'

/**
 * `import.meta.env.VITE_API_URL` permite apontar para outra maquina.
 * Vazio = caminho relativo `/api`, tratado pelo proxy do Vite. Isso e o que
 * faz o acesso pelo IP da LAN funcionar sem reconfigurar nada.
 */
const baseURL = import.meta.env.VITE_API_URL || ''

export const api: AxiosInstance = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

// ---------------------------------------------------------------------------
// TOKEN
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    // localStorage pode lancar em modo privado/iframe restrito.
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignora: a sessao apenas nao persiste entre recarregamentos */
  }
}

export function getStoredUser<T>(): T | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function setStoredUser(user: unknown | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {
    /* ignora */
  }
}

export function clearSession() {
  setToken(null)
  setStoredUser(null)
}

// ---------------------------------------------------------------------------
// INTERCEPTORS
// ---------------------------------------------------------------------------

/**
 * Injeta o JWT a cada requisicao.
 *
 * Ler do localStorage aqui (em vez de fixar `axios.defaults` no login) e o que
 * conserta o bug de recarregar a pagina: o header voltava vazio porque o
 * `defaults` vivia so em memoria e era perdido no reload.
 */
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/** Callback disparado quando a sessao expira, registrado pelo AuthProvider. */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: string; code?: string }>) => {
    const status = error.response?.status

    // 401 = token ausente, expirado ou invalido: encerra a sessao.
    // O `/login` e excecao: ali o 401 significa "senha errada", e derrubar a
    // sessao faria a mensagem de erro desaparecer da tela.
    const isLoginCall = error.config?.url?.includes('/auth/login')
    if (status === 401 && !isLoginCall) {
      clearSession()
      onUnauthorized?.()
    }

    return Promise.reject(error)
  },
)

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Envelope padrao do backend. */
interface Envelope<T> {
  success: boolean
  data: T
  error?: string
}

/**
 * Desembrulha `{ success, data }` e devolve so o `data`.
 *
 * Algumas rotas mais antigas (financeiro) respondem o objeto cru, sem
 * envelope. O teste do campo `success` cobre os dois formatos, para nao
 * precisar reescrever essas rotas e arriscar quebrar o que ja funciona.
 */
export function unwrap<T>(payload: Envelope<T> | T): T {
  if (
    payload &&
    typeof payload === 'object' &&
    'success' in payload &&
    'data' in payload
  ) {
    return (payload as Envelope<T>).data
  }

  /**
   * Envelope sem o campo `success`.
   *
   * As rotas de precificacao respondem apenas `{ data: [...] }`. A checagem
   * acima exigia `success` e `data` juntos, entao devolvia o envelope inteiro
   * no lugar da lista — o componente recebia um objeto onde esperava array e
   * quebrava com "rules is not iterable".
   *
   * O teste por chave unica evita falso positivo: uma entidade real trazida da
   * API tem outros campos (`id`, `name`), nunca so `data`.
   */
  if (
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    Object.keys(payload).length === 1 &&
    'data' in payload
  ) {
    return (payload as { data: T }).data
  }

  return payload as T
}

/** GET que ja devolve o conteudo desembrulhado. */
export async function apiGet<T>(url: string, params?: unknown): Promise<T> {
  const res = await api.get<Envelope<T> | T>(url, { params: params as object })
  return unwrap<T>(res.data)
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.post<Envelope<T> | T>(url, body)
  return unwrap<T>(res.data)
}

export async function apiPut<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.put<Envelope<T> | T>(url, body)
  return unwrap<T>(res.data)
}

export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  const res = await api.patch<Envelope<T> | T>(url, body)
  return unwrap<T>(res.data)
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await api.delete<Envelope<T> | T>(url)
  return unwrap<T>(res.data)
}

/**
 * Extrai a mensagem de erro legivel de uma falha do axios.
 * Sem isso a UI mostraria "Request failed with status code 400", que nao
 * ajuda o operador a entender que faltou escolher a proteina.
 */
export function errorMessage(err: unknown, fallback = 'Algo deu errado.'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: string; message?: string }
      | undefined
    if (data?.error) return data.error
    if (data?.message) return data.message
    if (err.code === 'ECONNABORTED') return 'A requisicao demorou demais.'
    if (!err.response) {
      return 'Sem conexao com o servidor. Verifique se o backend esta rodando.'
    }
  }
  if (err instanceof Error && err.message) return err.message
  return fallback
}

/** Fetcher para o SWR. */
export const swrFetcher = <T>(url: string): Promise<T> => apiGet<T>(url)
