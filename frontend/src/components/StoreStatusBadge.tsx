import { useState } from 'react'
import { Loader2, Power } from 'lucide-react'
import { apiPatch, errorMessage } from '../lib/api'
import { useAuth } from '../context/AuthContext'

/**
 * Resposta de `PATCH /api/store/toggle` — o mesmo `StoreStatus` do servidor.
 *
 * Esta interface declarava `{ isOpen: boolean }`, um campo que a rota NUNCA
 * devolveu. O resultado: `data.isOpen` era `undefined`, o `patchTenant` abaixo
 * gravava undefined e o badge voltava para "Loja fechada" mesmo com a loja
 * tendo aberto no banco. Quem clicava via o interruptor "nao funcionar" e
 * clicava de novo — invertendo o estado real a cada tentativa.
 *
 * A distincao entre os dois campos importa:
 *  - `switchOn` e a chave geral, que e o que ESTE botao controla.
 *  - `open` e o estado efetivo: chave ligada E dentro do horario cadastrado.
 * Sao coisas diferentes as 3h da manha, e e por isso que `reason` existe.
 */
interface ToggleResponse {
  open: boolean
  switchOn: boolean
  withinSchedule: boolean
  reason: string
  nextOpening: string | null
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
  /**
   * Aviso do servidor quando a chave esta ligada mas a loja segue fechada por
   * causa do horario cadastrado. Sem isto o operador liga a chave, ve o badge
   * continuar vermelho e conclui que o botao esta quebrado.
   */
  const [notice, setNotice] = useState('')

  const isOpen = Boolean(tenant?.isOpen)

  async function toggle() {
    setError('')
    setNotice('')
    setSaving(true)
    // Atualiza otimista: o clique responde na hora e desfaz se o servidor negar.
    const previous = isOpen
    patchTenant({ isOpen: !previous })
    try {
      const status = await apiPatch<ToggleResponse>('/api/store/toggle', {
        isOpen: !previous,
      })

      // `switchOn` (a chave), nao `open` (chave + horario): este botao controla
      // a chave, e refletir `open` faria o proprio clique parecer nao ter
      // funcionado fora do horario de atendimento.
      patchTenant({ isOpen: status.switchOn })

      if (status.switchOn && !status.open) {
        setNotice(status.reason)
      }
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
      {notice && !error && (
        <p role="status" className="px-1 text-[0.6875rem] leading-snug text-warn">
          {notice}
        </p>
      )}
    </div>
  )
}
