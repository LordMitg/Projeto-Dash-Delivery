/**
 * "Funcionários" — equipe do negocio ativo.
 *
 * O ponto central: o cargo NAO define o acesso. Gerente, garcom, caixa e
 * entregador aparecem apenas como atalhos que pre-marcam as caixas; o que vale e
 * exatamente o que o dono deixou marcado. Foi o pedido explicito — "eu escolho o
 * que cada um vê" — e e por isso que o formulario mostra as permissoes uma a uma
 * em vez de um seletor de cargo.
 *
 * O catalogo de permissoes vem de `GET /api/users/permissions`, nao de uma lista
 * local: e o mesmo arquivo que o servidor usa para autorizar. Se fosse duplicado
 * aqui, uma permissao nova apareceria na tela sem existir no backend (ou o
 * contrario) e o dono marcaria algo sem efeito.
 *
 * Tudo aqui e escopado ao negocio ativo. A mesma pessoa pode ser caixa nesta
 * loja e gerente na outra: sao dois vinculos independentes.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import {
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { apiDelete, apiPatch, apiPost, errorMessage, swrFetcher } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { permissionSummary } from '../lib/permissions'

interface Employee {
  membershipId: string
  id: string
  email: string
  firstName: string
  lastName: string
  phone?: string | null
  active: boolean
  role: string
  permissions: string[]
  isMe: boolean
}

interface PermissionCatalog {
  permissions: { key: string; label: string }[]
  groups: { title: string; keys: string[] }[]
  presets: { key: string; label: string; permissions: string[] }[]
}

export function EmployeesPage() {
  const { isOwner } = useAuth()
  const {
    data: employees,
    error,
    isLoading,
    mutate,
  } = useSWR<Employee[]>(isOwner ? '/api/users' : null, swrFetcher)
  // O catalogo nao muda durante a sessao; sem revalidacao no foco, evitamos
  // requisicoes repetidas so por trocar de aba.
  const { data: catalog } = useSWR<PermissionCatalog>(
    isOwner ? '/api/users/permissions' : null,
    swrFetcher,
    { revalidateOnFocus: false },
  )

  const [editing, setEditing] = useState<Employee | null>(null)
  const [creating, setCreating] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  // Guard de interface. O servidor tambem barra (`requireAdmin` em /api/users),
  // e e ele que garante — isto so evita a tela vazia com erro 403.
  if (!isOwner) {
    return (
      <p
        role="alert"
        className="max-w-2xl rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-ink"
      >
        Somente o dono do negócio gerencia a equipe e as permissões.
      </p>
    )
  }

  async function handleRemove(employee: Employee) {
    if (
      !window.confirm(
        `Remover o acesso de ${employee.firstName} a este negócio? Os pedidos que ela lançou continuam no histórico.`,
      )
    ) {
      return
    }
    setFeedback(null)
    try {
      await apiDelete(`/api/users/${employee.membershipId}`)
      await mutate()
      setFeedback({ kind: 'ok', text: `${employee.firstName} não tem mais acesso a este negócio.` })
    } catch (err) {
      setFeedback({ kind: 'bad', text: errorMessage(err, 'Não foi possível remover o acesso.') })
    }
  }

  async function toggleActive(employee: Employee) {
    setFeedback(null)
    try {
      await apiPatch(`/api/users/${employee.membershipId}`, { active: !employee.active })
      await mutate()
    } catch (err) {
      setFeedback({ kind: 'bad', text: errorMessage(err, 'Não foi possível alterar o acesso.') })
    }
  }

  return (
    <section className="flex max-w-4xl flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-ink">Funcionários</h2>
          <p className="text-sm text-slate">
            Você escolhe, pessoa por pessoa, o que cada um vê e pode fazer nesta loja.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating(true)
            setFeedback(null)
          }}
          className="flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
        >
          <UserPlus aria-hidden="true" className="h-4 w-4" />
          Novo funcionário
        </button>
      </header>

      {feedback && (
        <p
          role="alert"
          className={`rounded-md border px-3 py-2 text-sm ${
            feedback.kind === 'ok'
              ? 'border-good/30 bg-good-soft text-good'
              : 'border-bad/30 bg-bad-soft text-bad'
          }`}
        >
          {feedback.text}
        </p>
      )}

      {isLoading && (
        <p className="flex items-center gap-2 text-sm text-slate">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Carregando a equipe...
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad"
        >
          {errorMessage(error, 'Não foi possível carregar a equipe.')}
        </p>
      )}

      {employees && employees.length === 0 && (
        <p className="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-8 text-sm text-slate">
          <Users aria-hidden="true" className="h-4 w-4 shrink-0" />
          Nenhum funcionário ainda. Você é o único com acesso a esta loja.
        </p>
      )}

      {employees && employees.length > 0 && (
        <ul className="flex flex-col gap-2">
          {employees.map((employee) => (
            <li
              key={employee.membershipId}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4"
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-semibold text-ink"
              >
                {`${employee.firstName[0] ?? ''}${employee.lastName[0] ?? ''}`.toUpperCase() || '--'}
              </span>

              <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">
                    {employee.firstName} {employee.lastName}
                  </span>
                  {employee.role === 'owner' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-strong">
                      <ShieldCheck aria-hidden="true" className="h-3 w-3" />
                      Dono
                    </span>
                  )}
                  {!employee.active && (
                    <span className="rounded-full bg-bad-soft px-2 py-0.5 text-xs font-medium text-bad">
                      Acesso suspenso
                    </span>
                  )}
                </span>
                <span className="truncate text-xs text-slate">{employee.email}</span>
                <span className="text-xs text-slate">
                  {permissionSummary(employee.role, employee.permissions)}
                </span>
              </div>

              {/* O dono nao aparece com acoes: o servidor recusa alterar o
                  proprio vinculo, senao a loja ficaria sem ninguem capaz de
                  gerenciar acesso. */}
              {employee.role !== 'owner' && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(employee)
                      setFeedback(null)
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface"
                  >
                    <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleActive(employee)}
                    className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface"
                  >
                    {employee.active ? 'Suspender' : 'Reativar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemove(employee)}
                    aria-label={`Remover ${employee.firstName}`}
                    className="rounded-md p-1.5 text-slate hover:text-bad"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && catalog && (
        <EmployeeDialog
          catalog={catalog}
          employee={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={async (message) => {
            setCreating(false)
            setEditing(null)
            await mutate()
            setFeedback({ kind: 'ok', text: message })
          }}
        />
      )}
    </section>
  )
}

/**
 * Formulario de funcionario: cria ou edita.
 *
 * Um componente para os dois casos porque a parte que importa — a grade de
 * permissoes — e identica. O que muda e so o cabecalho e os campos de acesso
 * (e-mail e senha nao sao editaveis depois: o e-mail identifica a conta, que
 * pode existir em outra loja).
 */
function EmployeeDialog({
  catalog,
  employee,
  onClose,
  onSaved,
}: {
  catalog: PermissionCatalog
  employee: Employee | null
  onClose: () => void
  onSaved: (message: string) => Promise<void>
}) {
  const isEdit = Boolean(employee)

  const [firstName, setFirstName] = useState(employee?.firstName ?? '')
  const [lastName, setLastName] = useState(employee?.lastName ?? '')
  const [email, setEmail] = useState(employee?.email ?? '')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState(employee?.phone ?? '')
  const [vehicleType, setVehicleType] = useState('moto')
  const [plate, setPlate] = useState('')
  const [selected, setSelected] = useState<string[]>(employee?.permissions ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Rotulo por chave, para a grade nao depender da ordem dos grupos.
  const labelOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of catalog.permissions) map.set(p.key, p.label)
    return map
  }, [catalog.permissions])

  // Reaproveita o dialogo ao clicar "Editar" em outra pessoa sem fechar antes.
  useEffect(() => {
    setFirstName(employee?.firstName ?? '')
    setLastName(employee?.lastName ?? '')
    setEmail(employee?.email ?? '')
    setPassword('')
    setPhone(employee?.phone ?? '')
    setSelected(employee?.permissions ?? [])
    setError('')
  }, [employee?.membershipId])

  function toggle(key: string) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
    setError('')
  }

  /** Aplica um cargo pronto. Substitui a selecao — e um ponto de partida. */
  function applyPreset(permissions: string[]) {
    setSelected([...permissions])
    setError('')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      if (employee) {
        await apiPatch(`/api/users/${employee.membershipId}`, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim(),
          permissions: selected,
          // Só envia senha quando o dono digitou algo: string vazia seria
          // recusada pelo minimo de 6 caracteres.
          ...(password ? { newPassword: password } : {}),
        })
        await onSaved(`Acesso de ${firstName.trim()} atualizado.`)
      } else {
        const created = await apiPost<{ reusedExistingAccount?: boolean }>('/api/users', {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          password,
          phone: phone.trim(),
          vehicleType,
          plate: plate.trim(),
          preset: selected.includes('delivery:drive') ? 'delivery' : undefined,
          permissions: selected,
        })
        await onSaved(
          created.reusedExistingAccount
            ? `${firstName.trim()} já tinha conta no sistema e agora acessa esta loja com a senha que já usa.`
            : `${firstName.trim()} foi cadastrado e já pode entrar.`,
        )
      }
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar.'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-dialog-title"
        className="my-8 flex w-full max-w-2xl flex-col gap-5 rounded-xl border border-line bg-surface p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h3 id="employee-dialog-title" className="text-lg font-semibold text-ink">
              {isEdit ? `Editar ${employee?.firstName}` : 'Novo funcionário'}
            </h3>
            <p className="text-sm text-slate">
              Marque exatamente o que esta pessoa pode fazer nesta loja.
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {error && (
            <p
              role="alert"
              className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad"
            >
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-[8rem] flex-1 flex-col gap-1.5">
              <label htmlFor="empFirstName" className="text-sm font-medium text-ink">
                Nome
              </label>
              <input
                id="empFirstName"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink"
              />
            </div>
            <div className="flex min-w-[8rem] flex-1 flex-col gap-1.5">
              <label htmlFor="empLastName" className="text-sm font-medium text-ink">
                Sobrenome
              </label>
              <input
                id="empLastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink"
              />
            </div>
          </div>

          {selected.includes('delivery:drive') && (
            <div className="grid gap-3 rounded-xl border border-brand/25 bg-brand-soft/40 p-4 sm:grid-cols-3">
              <div className="sm:col-span-3"><p className="text-sm font-semibold text-ink">Dados do entregador</p><p className="text-xs text-slate">Esse acesso abre somente o leitor de QR Codes e a rota das entregas.</p></div>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Telefone<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm" /></label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Veículo<select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm"><option value="moto">Moto</option><option value="carro">Carro</option><option value="bicicleta">Bicicleta</option><option value="a_pe">A pé</option></select></label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Placa (opcional)<input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm" /></label>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
              <label htmlFor="empEmail" className="text-sm font-medium text-ink">
                E-mail de acesso
              </label>
              <input
                id="empEmail"
                type="email"
                required
                // Nao editavel depois: o e-mail identifica a CONTA, que pode
                // existir tambem em outra loja. Trocar aqui afetaria a pessoa em
                // lugares que este dono nao administra.
                disabled={isEdit}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="funcionario@sualoja.com"
                className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink disabled:opacity-60"
              />
              {isEdit && (
                <p className="text-xs text-slate">O e-mail identifica a conta e não muda.</p>
              )}
            </div>
            <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
              <label htmlFor="empPassword" className="text-sm font-medium text-ink">
                {isEdit ? 'Nova senha' : 'Senha'}
              </label>
              <input
                id="empPassword"
                type="password"
                required={!isEdit}
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEdit ? 'Deixe vazio para manter' : 'Mínimo 6 caracteres'}
                autoComplete="new-password"
                className="rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink"
              />
              {isEdit && (
                <p className="flex items-center gap-1 text-xs text-slate">
                  <KeyRound aria-hidden="true" className="h-3 w-3 shrink-0" />
                  Só se a pessoa esqueceu a senha.
                </p>
              )}
            </div>
          </div>

          {/* ---- Cargos como atalho ---- */}
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-sm font-medium text-ink">Começar de um cargo</p>
            <p className="text-xs text-slate">
              Atalho para marcar várias caixas de uma vez. Depois ajuste como quiser — o
              cargo não fica salvo, só as permissões marcadas.
            </p>
            <div className="flex flex-wrap gap-2">
              {catalog.presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => applyPreset(preset.permissions)}
                  className="rounded-full border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-ink hover:bg-brand-soft hover:text-brand-strong"
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => applyPreset([])}
                className="rounded-full border border-line bg-canvas px-3 py-1.5 text-xs font-medium text-slate hover:bg-surface"
              >
                Limpar tudo
              </button>
            </div>
          </div>

          {/* ---- Permissões, uma a uma ---- */}
          <fieldset className="flex flex-col gap-4 border-t border-line pt-4">
            <legend className="sr-only">Permissões</legend>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-ink">O que esta pessoa pode fazer</p>
              <span className="text-xs text-slate">
                {selected.length} de {catalog.permissions.length}
              </span>
            </div>

            {catalog.groups.map((group) => (
              <div key={group.title} className="flex flex-col gap-2">
                <p className="text-xs font-semibold tracking-wide text-slate uppercase">
                  {group.title}
                </p>
                <div className="flex flex-col gap-1.5">
                  {group.keys.map((key) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-canvas"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(key)}
                        onChange={() => toggle(key)}
                        className="h-4 w-4 shrink-0 accent-brand"
                      />
                      {labelOf.get(key) ?? key}
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {selected.length === 0 && (
              <p className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-ink">
                Sem nenhuma permissão marcada, esta pessoa consegue entrar mas não vê
                nenhuma tela.
              </p>
            )}
          </fieldset>

          <div className="flex justify-end gap-3 border-t border-line pt-4">
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
              className="flex h-11 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
            >
              {saving ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Plus aria-hidden="true" className="h-4 w-4" />
              )}
              {saving ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Cadastrar funcionário'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default EmployeesPage
