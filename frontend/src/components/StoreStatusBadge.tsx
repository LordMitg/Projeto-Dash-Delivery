import { useState } from 'react'
import { Loader2, Power } from 'lucide-react'
import { apiPatch, errorMessage } from '../lib/api'
import { useAuth } from '../context/AuthContext'

interface ToggleResponse {
  isOpen: boolean
}

/**
 * Interruptor de "loja aberta / fechada".
 *
 * Fica no menu porque é a informação que muda o comportamento de todo o resto:
 * com a loja fechada o backend recusa novos pedidos, então o operador precisa
 * ver esse estado sem procurar.
 *
 * Quem NAO pode alternar continua vendo o status, so sem o botao: esconder a
 * informacao deixaria o operador sem entender por que o PDV recusa pedidos.
 */
export function StoreStatusBadge() {
  const { tenant, patchTenant, can } = useAuth()
  // Antes era `canSeeFinancials` (= `reports:view`), que nao tem relacao com
  // abrir a loja: um gerente sem acesso a faturamento perdia o interruptor,
  // enquanto quem so via relatorio ganhava o poder de fechar a loja.
  const canToggle = can('store:toggle')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isOpen = Boolean(tenant?.isOpen)

  async function toggle() {
    setError('')
    setSaving(true)
    // Atualiza otimista: o clique responde na hora e desfaz se o servidor negar.
    const previous = isOpen
    patchTenant({ isOpen: !previous })
    try {
      const data = await apiPatch<ToggleResponse>('/api/store/toggle', {
        isOpen: !previous,
      })
      patchTenant({ isOpen: data.isOpen })
    } catch (err) {
      patchTenant({ isOpen: previous })
      setError(errorMessage(err, 'Não foi possível alterar o status.'))
    } finally {
      setSaving(false)
    }
  }

  const dot = (
    <span
      aria-hidden="true"
      className={`h-2 w-2 shrink-0 rounded-full ${isOpen ? 'bg-good' : 'bg-bad'}`}
    />
  )
  const label = isOpen ? 'Loja aberta' : 'Loja fechada'

  if (!canToggle) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-ink-soft px-3 py-2">
        {dot}
        <span className="text-xs font-medium text-white/80">{label}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={saving}
        aria-pressed={isOpen}
        className="flex items-center gap-2 rounded-md bg-ink-soft px-3 py-2 text-left transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? (
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-white/70" />
        ) : (
          dot
        )}
        <span className="flex-1 text-xs font-medium text-white/85">{label}</span>
        <Power aria-hidden="true" className="h-3.5 w-3.5 text-white/45" />
      </button>
      {error && (
        <p role="alert" className="px-1 text-[0.6875rem] leading-snug text-bad">
          {error}
        </p>
      )}
    </div>
  )
}
