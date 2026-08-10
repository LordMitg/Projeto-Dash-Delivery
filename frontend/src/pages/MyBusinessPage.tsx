/**
 * "Meu negócio" — perfil da loja ativa.
 *
 * Tudo que o cadastro pediu (e o que ele deixou opcional) fica editavel aqui:
 * nome, logo, telefone, endereco e horario de funcionamento. Sem esta tela, quem
 * pulou os campos opcionais no cadastro nao tinha como preenche-los depois.
 *
 * Dois endpoints, de proposito:
 *  - identidade e endereco vao para `PATCH /api/tenants/:id`;
 *  - horarios vao para `PUT /api/store/hours`, que valida cada janela E emite
 *    `store:status` no socket. Mandar horario pelo PATCH salvaria o dado, mas o
 *    PDV e o cardapio continuariam exibindo o status antigo ate um F5.
 *
 * Ambos exigem OWNER no servidor. O formulario fica somente-leitura para
 * funcionario em vez de escondido: ver o endereco da loja onde se trabalha e
 * legitimo, alterar nao.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Save, Store, Trash2, Upload, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiPatch, apiPut, errorMessage } from '../lib/api'
import { toCompactDataUrl } from '../lib/image'

/** Uma janela de atendimento: das 18:00 as 23:30. */
interface TimeWindow {
  from: string
  to: string
}

type Hours = Record<string, TimeWindow[]>

/** Ordem de exibicao. Segue o backend (domingo = 0, para casar com getDay()). */
const WEEKDAYS: { key: string; label: string; short: string }[] = [
  { key: 'mon', label: 'Segunda-feira', short: 'Seg' },
  { key: 'tue', label: 'Terça-feira', short: 'Ter' },
  { key: 'wed', label: 'Quarta-feira', short: 'Qua' },
  { key: 'thu', label: 'Quinta-feira', short: 'Qui' },
  { key: 'fri', label: 'Sexta-feira', short: 'Sex' },
  { key: 'sat', label: 'Sábado', short: 'Sáb' },
  { key: 'sun', label: 'Domingo', short: 'Dom' },
]

const EMPTY_HOURS: Hours = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] }

/** Normaliza o JSON do banco, que pode vir nulo, parcial ou com sujeira. */
function toHours(raw: unknown): Hours {
  const result: Hours = { ...EMPTY_HOURS }
  if (!raw || typeof raw !== 'object') return result
  for (const { key } of WEEKDAYS) {
    const windows = (raw as Record<string, unknown>)[key]
    if (!Array.isArray(windows)) continue
    result[key] = windows
      .map((w) => {
        const win = w as Partial<TimeWindow>
        return { from: String(win.from ?? ''), to: String(win.to ?? '') }
      })
      .filter((w) => w.from && w.to)
  }
  return result
}

const fieldClass =
  'rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm text-ink disabled:opacity-60'

export function MyBusinessPage() {
  const { tenant, isOwner, patchTenant, refresh } = useAuth()

  const [name, setName] = useState('')
  const [logoData, setLogoData] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [hours, setHours] = useState<Hours>(EMPTY_HOURS)

  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  // Semeia o formulario a partir do negocio ativo. A dependencia e `tenant?.id`,
  // nao `tenant`: com o objeto inteiro, qualquer atualizacao de status vinda do
  // socket sobrescreveria o que o dono acabou de digitar e ainda nao salvou.
  useEffect(() => {
    if (!tenant) return
    setName(tenant.name ?? '')
    setLogoData(tenant.logoData ?? null)
    setPhone(tenant.phone ?? '')
    setAddress(tenant.address ?? '')
    setCity(tenant.city ?? '')
    setState(tenant.state ?? '')
    setZipCode(tenant.zipCode ?? '')
    setHours(toHours(tenant.openingHours))
    setFeedback(null)
  }, [tenant?.id])

  function updateWindow(day: string, index: number, patch: Partial<TimeWindow>) {
    setHours((prev) => ({
      ...prev,
      [day]: (prev[day] ?? []).map((w, i) => (i === index ? { ...w, ...patch } : w)),
    }))
    setFeedback(null)
  }

  function addWindow(day: string) {
    setHours((prev) => {
      const current = prev[day] ?? []
      // O segundo turno ja comeca depois do primeiro: marmitaria abre no almoco
      // e reabre no jantar, e adivinhar isso poupa quatro digitacoes.
      const suggestion = current.length === 0 ? { from: '11:00', to: '14:00' } : { from: '18:00', to: '23:00' }
      return { ...prev, [day]: [...current, suggestion] }
    })
    setFeedback(null)
  }

  function removeWindow(day: string, index: number) {
    setHours((prev) => ({ ...prev, [day]: (prev[day] ?? []).filter((_, i) => i !== index) }))
    setFeedback(null)
  }

  /** Copia a segunda-feira para os outros dias: a maioria das lojas repete. */
  function copyMondayToAll() {
    setHours((prev) => {
      const base = prev.mon ?? []
      const next: Hours = { ...prev }
      for (const { key } of WEEKDAYS) next[key] = base.map((w) => ({ ...w }))
      return next
    })
    setFeedback(null)
  }

  async function handleLogo(file: File | undefined) {
    if (!file) return
    setFeedback(null)
    try {
      setLogoData(await toCompactDataUrl(file))
    } catch (err) {
      setFeedback({
        kind: 'bad',
        text: err instanceof Error ? err.message : 'Não foi possível usar esta imagem.',
      })
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!tenant) return
    setFeedback(null)

    // Valida antes de enviar: o servidor recusa `from` igual a `to` e formato
    // fora de HH:MM, e a mensagem dele chegaria sem dizer QUAL dia esta errado.
    for (const { key, label } of WEEKDAYS) {
      for (const w of hours[key] ?? []) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(w.from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(w.to)) {
          setFeedback({ kind: 'bad', text: `Horário incompleto em ${label}.` })
          return
        }
        if (w.from === w.to) {
          setFeedback({
            kind: 'bad',
            text: `Em ${label}, abertura e fechamento não podem ser iguais.`,
          })
          return
        }
      }
    }

    setSaving(true)
    try {
      // `null` (e nao string vazia) para limpar campo: o servidor distingue
      // "nao mandou" de "mandou vazio", e "" viraria um endereco em branco.
      const updated = await apiPatch<Record<string, unknown>>(`/api/tenants/${tenant.id}`, {
        name: name.trim(),
        logoData: logoData || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        zipCode: zipCode.trim() || null,
      })

      await apiPut('/api/store/hours', { openingHours: hours })

      // Atualiza a loja em memoria na hora (o nome aparece no cabecalho) e
      // recarrega a lista, para o alternador refletir o nome/logo novos.
      patchTenant({
        name: String(updated.name ?? name.trim()),
        logoData: logoData || null,
        openingHours: hours,
      })
      await refresh()
      setFeedback({ kind: 'ok', text: 'Dados do negócio salvos.' })
    } catch (err) {
      setFeedback({ kind: 'bad', text: errorMessage(err, 'Não foi possível salvar.') })
    } finally {
      setSaving(false)
    }
  }

  if (!tenant) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Carregando o negócio...
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-ink">Meu negócio</h2>
        <p className="text-sm text-slate">
          Estes dados aparecem no cardápio e na comanda impressa.
        </p>
      </header>

      {!isOwner && (
        <p
          role="alert"
          className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-ink"
        >
          Somente o dono altera os dados do negócio. Você pode consultar, mas não editar.
        </p>
      )}

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

      {/* ---- Identidade ---- */}
      <fieldset
        disabled={!isOwner}
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
      >
        <legend className="px-1 text-sm font-medium text-ink">Identidade</legend>

        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-canvas">
            {logoData ? (
              <img src={logoData} alt="Logo do negócio" className="h-full w-full object-cover" />
            ) : (
              <Store aria-hidden="true" className="h-6 w-6 text-slate" />
            )}
          </span>
          <div className="flex flex-col items-start gap-1">
            <label
              htmlFor="businessLogo"
              className={`inline-flex items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-sm font-medium text-ink ${
                isOwner ? 'cursor-pointer hover:bg-surface' : 'opacity-60'
              }`}
            >
              <Upload aria-hidden="true" className="h-4 w-4" />
              {logoData ? 'Trocar logo' : 'Enviar logo'}
            </label>
            <input
              id="businessLogo"
              type="file"
              accept="image/*"
              disabled={!isOwner}
              className="sr-only"
              onChange={(e) => void handleLogo(e.target.files?.[0])}
            />
            {logoData && isOwner && (
              <button
                type="button"
                onClick={() => setLogoData(null)}
                className="inline-flex items-center gap-1 text-xs text-slate hover:text-bad"
              >
                <X aria-hidden="true" className="h-3 w-3" />
                Remover logo
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="businessName" className="text-sm font-medium text-ink">
            Nome do negócio
          </label>
          <input
            id="businessName"
            required
            minLength={2}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setFeedback(null)
            }}
            className={fieldClass}
          />
          <p className="text-xs text-slate">
            O endereço do cardápio público não muda quando você renomeia a loja: clientes
            podem ter o link salvo.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="businessPhone" className="text-sm font-medium text-ink">
            Telefone
          </label>
          <input
            id="businessPhone"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              setFeedback(null)
            }}
            placeholder="(11) 90000-0000"
            className={fieldClass}
          />
        </div>
      </fieldset>

      {/* ---- Endereço ---- */}
      <fieldset
        disabled={!isOwner}
        className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
      >
        <legend className="px-1 text-sm font-medium text-ink">Endereço</legend>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="businessAddress" className="text-sm font-medium text-ink">
            Rua e número
          </label>
          <input
            id="businessAddress"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value)
              setFeedback(null)
            }}
            placeholder="Rua das Flores, 100"
            className={fieldClass}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
            <label htmlFor="businessCity" className="text-sm font-medium text-ink">
              Cidade
            </label>
            <input
              id="businessCity"
              value={city}
              onChange={(e) => {
                setCity(e.target.value)
                setFeedback(null)
              }}
              className={fieldClass}
            />
          </div>
          <div className="flex w-20 flex-col gap-1.5">
            <label htmlFor="businessState" className="text-sm font-medium text-ink">
              UF
            </label>
            <input
              id="businessState"
              maxLength={2}
              value={state}
              onChange={(e) => {
                setState(e.target.value.toUpperCase())
                setFeedback(null)
              }}
              className={fieldClass}
            />
          </div>
          <div className="flex w-32 flex-col gap-1.5">
            <label htmlFor="businessZip" className="text-sm font-medium text-ink">
              CEP
            </label>
            <input
              id="businessZip"
              value={zipCode}
              onChange={(e) => {
                setZipCode(e.target.value)
                setFeedback(null)
              }}
              placeholder="01234-000"
              className={fieldClass}
            />
          </div>
        </div>
      </fieldset>

      {/* ---- Horário ---- */}
      <fieldset
        disabled={!isOwner}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      >
        <legend className="px-1 text-sm font-medium text-ink">Horário de funcionamento</legend>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate">
            Dia sem horário fica fechado. A chave geral no menu fecha a loja a qualquer momento.
          </p>
          {isOwner && (
            <button
              type="button"
              onClick={copyMondayToAll}
              className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface"
            >
              Repetir segunda em todos
            </button>
          )}
        </div>

        <ul className="flex flex-col divide-y divide-line">
          {WEEKDAYS.map(({ key, label, short }) => {
            const windows = hours[key] ?? []
            return (
              <li key={key} className="flex flex-wrap items-start gap-3 py-3">
                <span className="w-16 shrink-0 pt-2 text-sm font-medium text-ink" title={label}>
                  {short}
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {windows.length === 0 ? (
                    <span className="pt-2 text-sm text-slate">Fechado</span>
                  ) : (
                    windows.map((w, index) => (
                      // Chave por indice de proposito: os campos sao editaveis e
                      // comecam vazios, entao usar o valor como chave remontaria
                      // o input a cada tecla e o foco se perderia.
                      <div key={index} className="flex flex-wrap items-center gap-2">
                        <label htmlFor={`${key}-from-${index}`} className="sr-only">
                          {label}: abre às
                        </label>
                        <input
                          id={`${key}-from-${index}`}
                          type="time"
                          value={w.from}
                          onChange={(e) => updateWindow(key, index, { from: e.target.value })}
                          className="rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-sm text-ink disabled:opacity-60"
                        />
                        <span aria-hidden="true" className="text-sm text-slate">
                          às
                        </span>
                        <label htmlFor={`${key}-to-${index}`} className="sr-only">
                          {label}: fecha às
                        </label>
                        <input
                          id={`${key}-to-${index}`}
                          type="time"
                          value={w.to}
                          onChange={(e) => updateWindow(key, index, { to: e.target.value })}
                          className="rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-sm text-ink disabled:opacity-60"
                        />
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => removeWindow(key, index)}
                            aria-label={`Remover turno de ${label}`}
                            className="rounded-md p-1.5 text-slate hover:text-bad"
                          >
                            <Trash2 aria-hidden="true" className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {isOwner && windows.length < 2 && (
                  <button
                    type="button"
                    onClick={() => addWindow(key)}
                    className="shrink-0 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface"
                  >
                    {windows.length === 0 ? 'Abrir neste dia' : 'Segundo turno'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </fieldset>

      {isOwner && (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
          >
            {saving ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="h-4 w-4" />
            )}
            {saving ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      )}
    </form>
  )
}

export default MyBusinessPage
