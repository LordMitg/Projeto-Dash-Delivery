/**
 * Alternador de negocios do cabecalho.
 *
 * O backend ja suportava varios negocios por conta (`Membership`) e o
 * AuthContext ja expunha `tenants` e `switchTenant`, mas nao havia nada na tela
 * que os usasse: um dono com duas lojas ficava preso na primeira. Este e o
 * componente que faltava.
 *
 * Duas coisas importantes acontecem aqui:
 *  - a troca vai ao SERVIDOR (`/auth/switch-tenant`), que confere o vinculo e
 *    devolve um token novo. O cliente nunca decide em que loja esta — se
 *    decidisse, trocar um id no navegador daria acesso a loja de outro dono.
 *  - criar negocio e seguido de troca automatica. Sem isso o dono criaria a
 *    segunda loja e continuaria olhando os dados da primeira, sem entender se
 *    deu certo.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, ChevronsUpDown, Loader2, Plus, Store, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiPost, errorMessage } from '../lib/api'
import { toCompactDataUrl } from '../lib/image'

export function TenantSwitcher() {
  const { tenant, tenants, switching, switchTenant, refresh } = useAuth()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora ou apertar Esc. Um menu que so fecha pelo proprio botao
  // fica preso sobre o conteudo quando o usuario desiste e clica na tela.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function handleSwitch(id: string) {
    setError('')
    setOpen(false)
    try {
      await switchTenant(id)
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível trocar de negócio.'))
    }
  }

  // Uma loja so: nao ha o que alternar, mas o dono ainda precisa do caminho para
  // adicionar a segunda. Mostramos o nome com o botao de criar, sem o menu.
  const hasChoice = tenants.length > 1

  return (
    <div ref={containerRef} className="relative flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={() => (hasChoice ? setOpen((v) => !v) : setCreating(true))}
        disabled={switching}
        aria-haspopup={hasChoice ? 'menu' : undefined}
        aria-expanded={hasChoice ? open : undefined}
        className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-canvas disabled:opacity-60"
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-canvas"
        >
          {tenant?.logoData ? (
            <img src={tenant.logoData} alt="" className="h-full w-full object-cover" />
          ) : (
            <Store className="h-3.5 w-3.5 text-slate" />
          )}
        </span>
        <span className="truncate text-sm font-semibold text-ink">
          {tenant?.name ?? 'Minha loja'}
        </span>
        {switching ? (
          <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-slate" />
        ) : (
          hasChoice && <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-slate" />
        )}
        <span className="sr-only">
          {hasChoice ? 'Trocar de negócio' : 'Adicionar outro negócio'}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Seus negócios"
          className="absolute top-full left-0 z-50 mt-1 flex w-72 flex-col gap-1 rounded-lg border border-line bg-surface p-1.5 shadow-lg"
        >
          {tenants.map((t) => {
            const active = t.id === tenant?.id
            return (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                onClick={() => void handleSwitch(t.id)}
                className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${
                  active ? 'bg-canvas' : 'hover:bg-canvas'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-canvas"
                >
                  {t.logoData ? (
                    <img src={t.logoData} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Store className="h-4 w-4 text-slate" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-ink">{t.name}</span>
                  <span className="text-xs text-slate">
                    {t.role === 'owner' ? 'Dono' : 'Funcionário'}
                    {t.isOpen ? ' · aberta' : ' · fechada'}
                  </span>
                </span>
                {active && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-brand" />}
              </button>
            )
          })}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              setCreating(true)
            }}
            className="mt-0.5 flex items-center gap-2 rounded-md border-t border-line px-2 py-2 text-sm font-medium text-brand hover:bg-canvas"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Adicionar negócio
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}

      {creating && (
        <NewBusinessDialog
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false)
            // Ordem: troca primeiro (token novo), depois recarrega a lista — que
            // e o unico jeito de o negocio recem-criado aparecer no alternador,
            // ja que `switch-tenant` nao reenvia os vinculos.
            await switchTenant(id)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

/**
 * Cadastro do negocio adicional.
 *
 * Pede so o nome. Endereco, horario e taxas ficam para a tela "Meu negócio":
 * quem esta abrindo a segunda loja quer ver o painel dela funcionando, nao
 * preencher doze campos antes.
 */
function NewBusinessDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (tenantId: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [logoData, setLogoData] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleLogo(file: File | undefined) {
    if (!file) return
    setError('')
    try {
      setLogoData(await toCompactDataUrl(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível usar esta imagem.')
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const created = await apiPost<{ id: string }>('/api/tenants', {
        name: name.trim(),
        ...(logoData ? { logoData } : {}),
      })
      await onCreated(created.id)
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível criar o negócio.'))
      // `saving` volta a false apenas no erro: no sucesso o componente e
      // desmontado pela troca de loja, e liberar o botao antes disso permitiria
      // um segundo clique criando a loja duas vezes.
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4 pt-20">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-business-title"
        className="flex w-full max-w-md flex-col gap-5 rounded-xl border border-line bg-surface p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="new-business-title" className="text-lg font-semibold text-ink">
              Adicionar negócio
            </h2>
            <p className="text-sm text-slate">
              Estoque, pedidos e caixa ficam separados dos seus outros negócios.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-slate hover:text-ink"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <p
              role="alert"
              className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="newBusinessName" className="text-sm font-medium text-ink">
              Nome do negócio
            </label>
            <input
              id="newBusinessName"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hamburgueria do Centro"
              className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink"
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-canvas">
              {logoData ? (
                <img src={logoData} alt="Logo escolhido" className="h-full w-full object-cover" />
              ) : (
                <Store aria-hidden="true" className="h-4 w-4 text-slate" />
              )}
            </span>
            <label
              htmlFor="newBusinessLogo"
              className="cursor-pointer rounded-lg border border-line bg-canvas px-3 py-2 text-sm font-medium text-ink hover:bg-surface"
            >
              {logoData ? 'Trocar logo' : 'Enviar logo (opcional)'}
            </label>
            <input
              id="newBusinessLogo"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void handleLogo(e.target.files?.[0])}
            />
          </div>

          <div className="mt-1 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex h-11 items-center justify-center rounded-lg border border-line bg-canvas px-4 text-sm font-medium text-ink hover:bg-surface"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
            >
              {saving && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              {saving ? 'Criando...' : 'Criar e abrir'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
