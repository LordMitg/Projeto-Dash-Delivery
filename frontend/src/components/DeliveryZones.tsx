/**
 * Cadastro de bairros com taxa de entrega propria.
 *
 * O backend ja resolvia a taxa por bairro (`resolveDeliveryFee`) e ja expunha
 * `PUT /api/store/delivery` — mas nao havia tela para cadastrar as zonas, e o
 * PDV cobrava a taxa base para todo mundo. Esta tela e a metade que faltava.
 *
 * A taxa NUNCA e enviada pelo PDV no fechamento: o pedido informa apenas o nome
 * do bairro e o servidor busca o valor aqui. Por isso esta tela e a unica fonte
 * de verdade sobre quanto se cobra de entrega.
 */
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { Loader2, MapPin, Plus, Save, Trash2 } from 'lucide-react'
import { apiPut, errorMessage, swrFetcher } from '../lib/api'
import { useAuth } from '../context/AuthContext'

interface Zone {
  name: string
  fee: number
  minOrder: number
  etaMinutes: number
}

interface StoreSettings {
  deliveryFeeBase: string | number
  deliveryZones: Zone[] | null
}

/** Normaliza o que vem do banco: `deliveryZones` e Json e pode vir nulo. */
function toZones(raw: unknown): Zone[] {
  if (!Array.isArray(raw)) return []
  return raw.map((z) => {
    const zone = z as Partial<Zone>
    return {
      name: String(zone.name ?? ''),
      fee: Number(zone.fee ?? 0),
      minOrder: Number(zone.minOrder ?? 0),
      etaMinutes: Number(zone.etaMinutes ?? 40),
    }
  })
}

export function DeliveryZones() {
  const { isOwner } = useAuth()
  const { data, error, isLoading, mutate } = useSWR<StoreSettings>(
    '/api/store/settings',
    swrFetcher,
  )

  const [base, setBase] = useState('0')
  const [zones, setZones] = useState<Zone[]>([])
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null)

  // Semeia o formulario quando os dados chegam. Sem depender de `data` aqui, um
  // salvamento seguido de revalidacao sobrescreveria o que o operador digitou.
  useEffect(() => {
    if (!data) return
    setBase(String(Number(data.deliveryFeeBase ?? 0)))
    setZones(toZones(data.deliveryZones))
  }, [data])

  // `PUT /api/store/delivery` usa `requireAdmin`, que hoje significa OWNER.
  //
  // Esta linha comparava com 'admin', um papel que deixou de existir quando o
  // vinculo passou a ser `owner`/`staff` — resultado: `canEdit` era sempre falso
  // e nem o proprio dono conseguia editar as taxas. Espelhar o servidor evita
  // tambem o caso oposto: formulario editavel que devolve 403 ao salvar, depois
  // de a tela toda ter sido preenchida.
  const canEdit = isOwner

  function updateZone(index: number, patch: Partial<Zone>) {
    setZones((list) => list.map((z, i) => (i === index ? { ...z, ...patch } : z)))
    setFeedback(null)
  }

  function addZone() {
    setZones((list) => [...list, { name: '', fee: 0, minOrder: 0, etaMinutes: 40 }])
    setFeedback(null)
  }

  function removeZone(index: number) {
    setZones((list) => list.filter((_, i) => i !== index))
    setFeedback(null)
  }

  async function save() {
    // Validacao local antes do request: bairro sem nome e o erro mais comum
    // (linha adicionada e nao preenchida) e o servidor devolveria um 400 seco.
    const cleaned = zones.map((z) => ({ ...z, name: z.name.trim() }))
    if (cleaned.some((z) => !z.name)) {
      setFeedback({ kind: 'bad', text: 'Todo bairro precisa de um nome.' })
      return
    }

    const duplicated = cleaned
      .map((z) => z.name.toLowerCase())
      .find((name, i, all) => all.indexOf(name) !== i)
    if (duplicated) {
      setFeedback({
        kind: 'bad',
        text: `O bairro "${duplicated}" está repetido. A taxa ficaria ambígua.`,
      })
      return
    }

    setSaving(true)
    setFeedback(null)
    try {
      await apiPut('/api/store/delivery', {
        deliveryFeeBase: Number(base) || 0,
        deliveryZones: cleaned,
      })
      await mutate()
      setFeedback({ kind: 'ok', text: 'Taxas salvas. O PDV já usa os novos valores.' })
    } catch (err) {
      setFeedback({ kind: 'bad', text: errorMessage(err, 'Não foi possível salvar.') })
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Carregando configuração de entrega...
      </p>
    )
  }

  if (error) {
    return (
      <p role="alert" className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
        {errorMessage(error, 'Não foi possível carregar a configuração de entrega.')}
      </p>
    )
  }

  return (
    <section aria-labelledby="zones-title" className="flex max-w-3xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 id="zones-title" className="text-xl font-semibold text-ink">
          Bairros e taxas de entrega
        </h2>
        <p className="text-sm text-slate">
          O PDV cobra a taxa do bairro escolhido. Bairro sem cadastro usa a taxa padrão.
        </p>
      </header>

      {!canEdit && (
        <p
          role="alert"
          className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-ink"
        >
          Somente administradores alteram as taxas de entrega. Você pode consultar os
          valores, mas não editá-los.
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

      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
        <label htmlFor="base-fee" className="text-sm font-medium text-ink">
          Taxa padrão
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate">R$</span>
          <input
            id="base-fee"
            type="number"
            min="0"
            step="0.50"
            value={base}
            disabled={!canEdit}
            onChange={(e) => {
              setBase(e.target.value)
              setFeedback(null)
            }}
            className="w-28 rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm text-ink disabled:opacity-60"
          />
        </div>
        <p className="text-sm text-slate">
          Usada quando o pedido é de entrega e o bairro não está na lista abaixo.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-ink">Bairros atendidos</h3>
          <span className="font-mono text-sm text-slate">{zones.length}</span>
        </div>

        {zones.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-6 text-sm text-slate">
            <MapPin aria-hidden="true" className="h-4 w-4 shrink-0" />
            Nenhum bairro cadastrado. Todo delivery usa a taxa padrão.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {zones.map((zone, index) => (
              // A chave e o indice de propósito: o nome e editavel e comeca
              // vazio, entao usa-lo como chave remontaria o input a cada letra
              // digitada e o campo perderia o foco.
              <li
                key={index}
                className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-canvas p-3"
              >
                <div className="flex min-w-[10rem] flex-1 flex-col gap-1">
                  <label
                    htmlFor={`zone-name-${index}`}
                    className="text-xs font-medium uppercase tracking-wide text-slate"
                  >
                    Bairro
                  </label>
                  <input
                    id={`zone-name-${index}`}
                    value={zone.name}
                    disabled={!canEdit}
                    onChange={(e) => updateZone(index, { name: e.target.value })}
                    placeholder="Centro"
                    className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60"
                  />
                </div>

                <div className="flex w-24 flex-col gap-1">
                  <label
                    htmlFor={`zone-fee-${index}`}
                    className="text-xs font-medium uppercase tracking-wide text-slate"
                  >
                    Taxa R$
                  </label>
                  <input
                    id={`zone-fee-${index}`}
                    type="number"
                    min="0"
                    step="0.50"
                    aria-label={`Taxa de entrega em reais${zone.name ? ` de ${zone.name}` : ''}`}
                    value={zone.fee}
                    disabled={!canEdit}
                    onChange={(e) => updateZone(index, { fee: Number(e.target.value) || 0 })}
                    className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink disabled:opacity-60"
                  />
                </div>

                <div className="flex w-28 flex-col gap-1">
                  <label
                    htmlFor={`zone-min-${index}`}
                    className="text-xs font-medium uppercase tracking-wide text-slate"
                  >
                    Pedido mín.
                  </label>
                  {/* O prefixo "R$" evita o campo vizinho (minutos) ser lido
                      como dinheiro: os dois sao numeros de 2 digitos. */}
                  <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-2">
                    <span aria-hidden="true" className="text-xs text-slate">
                      R$
                    </span>
                    <input
                      id={`zone-min-${index}`}
                      type="number"
                      min="0"
                      step="1"
                      aria-label={`Pedido minimo em reais${zone.name ? ` de ${zone.name}` : ''}`}
                      value={zone.minOrder}
                      disabled={!canEdit}
                      onChange={(e) => updateZone(index, { minOrder: Number(e.target.value) || 0 })}
                      className="w-full bg-transparent font-mono text-sm text-ink outline-none disabled:opacity-60"
                    />
                  </div>
                </div>

                <div className="flex w-24 flex-col gap-1">
                  <label
                    htmlFor={`zone-eta-${index}`}
                    className="text-xs font-medium uppercase tracking-wide text-slate"
                  >
                    Entrega
                  </label>
                  <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-2">
                    <input
                      id={`zone-eta-${index}`}
                      type="number"
                      min="0"
                      step="5"
                      aria-label={`Tempo de entrega em minutos${zone.name ? ` de ${zone.name}` : ''}`}
                      value={zone.etaMinutes}
                      disabled={!canEdit}
                      onChange={(e) =>
                        updateZone(index, { etaMinutes: Number(e.target.value) || 0 })
                      }
                      className="w-full bg-transparent font-mono text-sm text-ink outline-none disabled:opacity-60"
                    />
                    <span aria-hidden="true" className="text-xs text-slate">
                      min
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeZone(index)}
                  disabled={!canEdit}
                  aria-label={`Remover ${zone.name || 'bairro'}`}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line text-slate transition-colors hover:border-bad/40 hover:text-bad disabled:opacity-60"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={addZone}
          disabled={!canEdit}
          className="inline-flex items-center justify-center gap-2 self-start rounded-md border border-line px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-60"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Adicionar bairro
        </button>
      </div>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !canEdit}
        className="inline-flex items-center justify-center gap-2 self-start rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
      >
        {saving ? (
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : (
          <Save aria-hidden="true" className="h-4 w-4" />
        )}
        {saving ? 'Salvando...' : 'Salvar taxas'}
      </button>
    </section>
  )
}

export default DeliveryZones
