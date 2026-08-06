import type { ReactNode } from 'react'
import { useAuth, type AuthTenant, type TenantSummary } from './AuthContext'

/**
 * Camada de compatibilidade sobre o AuthContext.
 *
 * Historico: a primeira versao buscava `GET /api/tenants` para montar um seletor
 * de empresa, mas cada conta pertencia a exatamente uma loja — o seletor nao
 * tinha o que trocar e `switchTenant` era um stub vazio.
 *
 * Agora uma conta pode ter vários negócios, e a troca existe de verdade: ela vai
 * ao servidor, que confirma o vínculo e devolve um token novo. O cliente nunca
 * decide sozinho em que loja está — se decidisse, seria falha de isolamento.
 *
 * Oito componentes ainda chamam `useTenant()`, então o formato de retorno é
 * preservado e a loja continua vindo de uma única fonte de verdade.
 */
interface TenantCompat {
  activeTenant: AuthTenant | null
  /** Alias: alguns componentes usam este nome. */
  currentTenant: AuthTenant | null
  /** Todos os negócios da conta. */
  tenants: TenantSummary[]
  loading: boolean
  /** `true` enquanto o servidor reemite o token da nova loja. */
  switching: boolean
  /** Troca o negócio ativo. Assíncrono: depende do servidor. */
  switchTenant: (tenantId: string) => Promise<void>
}

export function useTenant(): TenantCompat {
  const { tenant, tenants, loading, switching, switchTenant } = useAuth()
  return {
    activeTenant: tenant,
    currentTenant: tenant,
    tenants,
    loading,
    switching,
    switchTenant,
  }
}

/** Mantido para não quebrar importações antigas; o AuthProvider já envolve tudo. */
export function TenantProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}
