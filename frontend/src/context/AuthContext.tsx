import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useSWRConfig } from 'swr'
import {
  apiGet,
  apiPost,
  clearSession,
  errorMessage,
  getStoredUser,
  getToken,
  setStoredUser,
  setToken,
  setUnauthorizedHandler,
} from '../lib/api'
import { closeRealtime } from '../hooks/useRealtime'

/**
 * Sessao da aplicacao.
 *
 * Uma conta pode pertencer a VARIOS negocios (`Membership` no backend). O token
 * carrega o negocio ativo; papel e permissoes vem do vinculo daquele negocio —
 * a mesma pessoa pode ser dona de uma loja e operadora de caixa em outra.
 *
 * Por isso `role` e `permissions` moram aqui junto do `tenant` ativo: eles
 * mudam JUNTOS a cada troca de loja.
 */

/** Papel dentro de um negocio. */
export type MembershipRole = 'owner' | 'staff'

export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  /** Papel no negocio ATIVO, nao um atributo global da pessoa. */
  role: MembershipRole | string
  /** Permissoes do vinculo ativo. Vazio para `owner`, que pode tudo. */
  permissions: string[]
  /** `true` para contas antigas, sem perguntas de recuperacao definidas. */
  needsSecurityQuestions?: boolean
}

/**
 * Zona de entrega configurada pela loja: bairro + taxa propria.
 *
 * Espelha `deliveryZoneSchema` (backend/src/services/storeService.ts). Faltavam
 * aqui `minOrder` e `etaMinutes`: o servidor ja validava e persistia os dois,
 * mas sem a declaracao o frontend nao tinha como exibi-los.
 */
export interface DeliveryZone {
  name: string
  fee: number
  /** Pedido minimo do bairro. 0 = sem minimo. */
  minOrder: number
  /** Tempo estimado de entrega, em minutos. */
  etaMinutes: number
}

/** Negocio ativo, com tudo que as telas precisam. */
export interface AuthTenant {
  id: string
  name: string
  slug: string
  isOpen: boolean
  logoData?: string | null
  openingHours?: unknown
  address?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
  phone?: string | null
  printSettings?: unknown
  /**
   * A taxa e as zonas de entrega ja vinham em `/auth/login` e `/auth/me`, mas
   * nao estavam declaradas aqui — e o PDV, sem acesso a elas, exibia um total
   * SEM a taxa que o servidor cobra de fato. O operador fechava a venda pelo
   * valor errado. Declarar os campos e o que permite mostrar o total real.
   */
  deliveryFeeBase?: string | number
  deliveryZones?: DeliveryZone[]
}

/** Item do alternador de negocios do cabecalho. */
export interface TenantSummary {
  id: string
  name: string
  slug: string
  logoData?: string | null
  isOpen: boolean
  /** Papel da conta NESTE negocio. */
  role: MembershipRole | string
}

/** Resposta de `/auth/login` quando ha ao menos um vinculo. */
interface SessionResponse {
  token: string
  user: AuthUser
  tenant: AuthTenant
  tenants: TenantSummary[]
}

/**
 * Login de uma conta sem nenhum negocio (o dono apagou a ultima loja).
 * Nao traz token: nao ha loja para assinar no JWT.
 */
interface NeedsBusinessResponse {
  needsBusiness: true
  user: Pick<AuthUser, 'id' | 'email' | 'firstName' | 'lastName'>
}

type LoginResponse = SessionResponse | NeedsBusinessResponse

interface MeResponse {
  user: AuthUser
  tenant: AuthTenant
  tenants: TenantSummary[]
}

/** `switch-tenant` nao reenvia a lista: os vinculos nao mudaram. */
interface SwitchResponse {
  token: string
  user: AuthUser
  tenant: AuthTenant
}

interface StoredSession {
  user: AuthUser
  tenant: AuthTenant
  tenants: TenantSummary[]
}

export interface LoginResult {
  /** `true` = a conta existe mas nao tem negocio; leve ao cadastro de negocio. */
  needsBusiness: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  tenant: AuthTenant | null
  /** Todos os negocios da conta, para o alternador. */
  tenants: TenantSummary[]
  /** `true` enquanto a sessao salva ainda esta sendo validada. */
  loading: boolean
  /** `true` durante a troca de negocio, para travar a interface. */
  switching: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<LoginResult>
  /** Cria conta + primeiro negocio e ja abre a sessao. */
  signup: (payload: Record<string, unknown>) => Promise<void>
  logout: () => void
  /** Troca o negocio ativo: reemite o token e limpa o cache do anterior. */
  switchTenant: (tenantId: string) => Promise<void>
  /** Recarrega usuario, loja e lista de negocios. */
  refresh: () => Promise<void>
  /** Atualiza a loja em memoria sem ir ao servidor. */
  patchTenant: (partial: Partial<AuthTenant>) => void
  /** Checa uma permissao do vinculo ativo. `owner` sempre pode. */
  can: (permission: string) => boolean
  /** `true` para o dono do negocio ativo. */
  isOwner: boolean
  /** Atalho historico: quem pode ver relatorios com dinheiro. */
  canSeeFinancials: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Diferencia as duas formas de resposta do login. */
function needsBusiness(data: LoginResponse): data is NeedsBusinessResponse {
  return 'needsBusiness' in data && data.needsBusiness === true
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Comeca com o usuario do localStorage para a interface nao "piscar" o login
  // durante a validacao. `loading` continua true ate o /me responder.
  const stored = getStoredUser<StoredSession>()
  const [user, setUser] = useState<AuthUser | null>(stored?.user ?? null)
  const [tenant, setTenant] = useState<AuthTenant | null>(stored?.tenant ?? null)
  const [tenants, setTenants] = useState<TenantSummary[]>(stored?.tenants ?? [])
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)

  const { mutate } = useSWRConfig()

  /**
   * Descarta TODO o cache do SWR.
   *
   * Sem isto, trocar de loja mantinha os dados da anterior na tela: as chaves
   * do SWR (`/api/orders`, `/api/store/settings`) nao incluem o id da loja,
   * porque o servidor filtra pelo token. Duas lojas = mesma chave = a cozinha
   * da loja B exibiria os pedidos da loja A.
   */
  const clearCache = useCallback(async () => {
    // Revalida em seguida, para as telas montadas voltarem a carregar ja com o
    // token novo em vez de ficarem vazias.
    await mutate(() => true, undefined, { revalidate: true })
  }, [mutate])

  const applySession = useCallback(
    (data: { user: AuthUser; tenant: AuthTenant; tenants?: TenantSummary[] }) => {
      const list = data.tenants ?? tenants
      setUser(data.user)
      setTenant(data.tenant)
      setTenants(list)
      setStoredUser({ user: data.user, tenant: data.tenant, tenants: list })
    },
    [tenants],
  )

  const logout = useCallback(() => {
    // Derruba o socket junto com a sessao: mantido aberto, ele continuaria na
    // sala da loja autenticado com o token de quem acabou de sair.
    closeRealtime()
    clearSession()
    setUser(null)
    setTenant(null)
    setTenants([])
    void clearCache()
  }, [clearCache])

  // Deixa o interceptor do axios derrubar a sessao ao receber 401.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      // Tambem aqui: com o token invalidado, o socket entraria em loop de
      // reconexao usando a credencial que o servidor acabou de recusar.
      closeRealtime()
      setUser(null)
      setTenant(null)
      setTenants([])
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  /**
   * Valida a sessao salva no primeiro render.
   *
   * O bug anterior era encerrar o `loading` FORA do await: a aplicacao se dava
   * por carregada antes da validacao terminar, redirecionava para o login e
   * depois voltava — o famoso "piscar" da tela de login.
   */
  useEffect(() => {
    let cancelled = false

    async function validate() {
      if (!getToken()) {
        if (!cancelled) {
          setUser(null)
          setTenant(null)
          setTenants([])
          setLoading(false)
        }
        return
      }

      try {
        const me = await apiGet<MeResponse>('/api/auth/me')
        if (cancelled) return
        setUser(me.user)
        setTenant(me.tenant)
        setTenants(me.tenants ?? [])
        setStoredUser(me)
      } catch {
        // Token expirado, acesso revogado ou backend fora do ar.
        if (!cancelled) {
          clearSession()
          setUser(null)
          setTenant(null)
          setTenants([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void validate()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      try {
        const data = await apiPost<LoginResponse>('/api/auth/login', {
          email,
          password,
          // Reabre na ultima loja usada, em vez de sempre na primeira.
          tenantId: getStoredUser<StoredSession>()?.tenant?.id,
        })

        if (needsBusiness(data)) {
          // Sem token: a conta precisa criar um negocio antes de entrar.
          return { needsBusiness: true }
        }

        // Grava o token ANTES de tocar no state: qualquer requisicao disparada
        // pela re-renderizacao ja sai autenticada.
        setToken(data.token)
        applySession(data)
        return { needsBusiness: false }
      } catch (err) {
        throw new Error(errorMessage(err, 'Nao foi possivel entrar.'))
      }
    },
    [applySession],
  )

  const signup = useCallback(
    async (payload: Record<string, unknown>) => {
      try {
        const data = await apiPost<SessionResponse>('/api/auth/signup', payload)
        setToken(data.token)
        applySession(data)
      } catch (err) {
        throw new Error(errorMessage(err, 'Nao foi possivel criar a conta.'))
      }
    },
    [applySession],
  )

  /**
   * Alterna o negocio ativo.
   *
   * O servidor reemite o token depois de confirmar o vinculo — o cliente nao
   * "escolhe" a loja, ele pede a troca e recebe uma credencial nova.
   */
  const switchTenant = useCallback(
    async (tenantId: string) => {
      if (!tenantId || tenantId === tenant?.id) return
      setSwitching(true)
      try {
        const data = await apiPost<SwitchResponse>('/api/auth/switch-tenant', {
          tenantId,
        })
        // Ordem importa: token novo primeiro, cache depois. Invertido, a
        // revalidacao sairia com o token da loja anterior.
        setToken(data.token)
        applySession(data)
        // O socket estava na sala da loja antiga; reconecta na nova.
        closeRealtime()
        await clearCache()
      } catch (err) {
        throw new Error(errorMessage(err, 'Nao foi possivel trocar de negocio.'))
      } finally {
        setSwitching(false)
      }
    },
    [tenant?.id, applySession, clearCache],
  )

  const refresh = useCallback(async () => {
    if (!getToken()) return
    try {
      const me = await apiGet<MeResponse>('/api/auth/me')
      setUser(me.user)
      setTenant(me.tenant)
      setTenants(me.tenants ?? [])
      setStoredUser(me)
    } catch {
      /* o interceptor trata o 401 */
    }
  }, [])

  const patchTenant = useCallback((partial: Partial<AuthTenant>) => {
    setTenant((prev) => (prev ? { ...prev, ...partial } : prev))
  }, [])

  const isOwner = user?.role === 'owner'

  /**
   * Autorizacao da interface.
   *
   * Espelha `requirePermission` do backend: o dono passa sempre, o funcionario
   * depende da lista do vinculo. Isto so esconde botoes — quem garante o acesso
   * e o servidor, que revalida o vinculo a cada requisicao.
   */
  const can = useCallback(
    (permission: string) => {
      if (!user) return false
      if (user.role === 'owner') return true
      return user.permissions?.includes(permission) ?? false
    },
    [user],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      tenant,
      tenants,
      loading,
      switching,
      isAuthenticated: Boolean(user),
      login,
      signup,
      logout,
      switchTenant,
      refresh,
      patchTenant,
      can,
      isOwner,
      canSeeFinancials: can('reports:view'),
    }),
    [
      user,
      tenant,
      tenants,
      loading,
      switching,
      login,
      signup,
      logout,
      switchTenant,
      refresh,
      patchTenant,
      can,
      isOwner,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth precisa estar dentro de <AuthProvider>.')
  }
  return ctx
}
