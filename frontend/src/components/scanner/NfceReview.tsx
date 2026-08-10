/**
 * Conferencia da nota antes de gravar.
 *
 * Esta tela existe por uma regra do projeto: NADA entra no estoque sem o
 * usuario confirmar. Ela recebe o que a SEFAZ devolveu, deixa tudo corrigivel
 * (quantidade, unidade, preco, vinculo) e so entao monta o corpo do
 * `POST /api/scanner/stock-entry`. O que a SEFAZ mandou nunca e gravado direto.
 *
 * A distincao visual entre os tipos de sugestao e deliberada: casar por codigo
 * de barras e praticamente certo, casar por nome e um palpite. Mostrar os dois
 * iguais faria o operador confirmar um palpite errado no automatico — e um erro
 * de vinculo contamina o CMV silenciosamente, aparecendo semanas depois como
 * uma margem inexplicavel.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Barcode,
  Check,
  CircleHelp,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { apiGet, apiPost, errorMessage } from '../../lib/api'
import type {
  IngredientOption,
  NfceItem,
  NfceResult,
  StockEntryItem,
  StockEntryResult,
} from './types'

/** Linha editavel da conferencia. Tudo em texto para o campo aceitar digitacao parcial. */
interface DraftItem {
  key: string
  /** `ignore` nao vai no corpo da requisicao: o item simplesmente nao e enviado. */
  action: 'link' | 'create' | 'ignore'
  ingredientId: string
  newName: string
  newUnit: string
  newBarcode: string
  codigo: string
  descricao: string
  quantity: string
  unitPrice: string
  matchedBy: 'barcode' | 'nome' | null
  confidence: number
  matchName: string
  matchStock: number
}

/** Aceita "1.234,56" e "1234.56" — o operador digita do jeito brasileiro. */
function parseDecimal(raw: string): number {
  const cleaned = String(raw ?? '').replace(/\s/g, '').replace(/[^\d.,-]/g, '')
  if (!cleaned) return 0
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned
  const value = Number(normalized)
  return Number.isFinite(value) ? value : 0
}

function brl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Mostra numero sem casas decimais inuteis: 0,156 kg mas 3 un. */
function qty(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 4 })
}

function itemToDraft(item: NfceItem, index: number): DraftItem {
  const hasMatch = Boolean(item.match)
  return {
    key: `${item.numeroItem}-${index}`,
    // Palpite por nome NAO vem pre-aprovado: `link` so e o padrao quando o
    // codigo de barras confere. Pre-selecionar um palpite seria transformar
    // "confira isso" em "confirmado" com um clique distraido.
    action: item.match?.matchedBy === 'barcode' ? 'link' : hasMatch ? 'link' : 'create',
    ingredientId: item.match?.ingredientId ?? '',
    newName: item.descricao,
    newUnit: item.unit || 'un',
    newBarcode: item.codigo ?? '',
    codigo: item.codigo ?? '',
    descricao: item.descricao,
    quantity: String(item.quantity).replace('.', ','),
    unitPrice: String(item.unitPrice.toFixed(2)).replace('.', ','),
    matchedBy: item.match?.matchedBy ?? null,
    confidence: item.match?.confidence ?? 0,
    matchName: item.match?.name ?? '',
    matchStock: item.match?.stock ?? 0,
  }
}

function emptyDraft(): DraftItem {
  return {
    key: `novo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    action: 'create',
    ingredientId: '',
    newName: '',
    newUnit: 'un',
    newBarcode: '',
    codigo: '',
    descricao: '',
    quantity: '1',
    unitPrice: '0',
    matchedBy: null,
    confidence: 0,
    matchName: '',
    matchStock: 0,
  }
}

interface NfceReviewProps {
  nota: NfceResult
  /** Voltar para o scanner sem gravar. */
  onCancel: () => void
  onSaved: (result: StockEntryResult) => void
  /** `false` esconde o botao de gravar e explica por que. */
  canSave: boolean
}

export function NfceReview({ nota, onCancel, onSaved, canSave }: NfceReviewProps) {
  const [drafts, setDrafts] = useState<DraftItem[]>(() => nota.items.map(itemToDraft))
  const [ingredients, setIngredients] = useState<IngredientOption[]>([])
  const [loadingIngredients, setLoadingIngredients] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // O cadastro e carregado uma vez para alimentar todos os seletores de
  // vinculo. Sem ele o usuario nao consegue corrigir um palpite errado.
  useEffect(() => {
    let alive = true
    apiGet<IngredientOption[]>('/api/ingredients', { active: true })
      .then((list) => {
        if (alive) setIngredients(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        // Falhar aqui nao impede a conferencia: os itens com match sugerido
        // continuam vinculaveis e os demais podem ser criados.
        if (alive) setIngredients([])
      })
      .finally(() => {
        if (alive) setLoadingIngredients(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const patch = (key: string, changes: Partial<DraftItem>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...changes } : d)))
  }

  const included = drafts.filter((d) => d.action !== 'ignore')

  const somaItens = useMemo(
    () =>
      included.reduce(
        (acc, d) => acc + parseDecimal(d.quantity) * parseDecimal(d.unitPrice),
        0,
      ),
    [included],
  )

  // Divergencia entre a soma conferida e o total da nota. Nao bloqueia (pode
  // haver item ignorado de proposito), mas precisa ser visivel: e o unico
  // sinal de que o parser leu uma quantidade errada.
  const totalNota = nota.valorTotal ?? 0
  const divergencia = totalNota > 0 ? somaItens - totalNota : 0
  const divergente = totalNota > 0 && Math.abs(divergencia) > 0.05

  /** Erros de preenchimento, por chave de item. Valida na hora de gravar. */
  const problemas = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of drafts) {
      if (d.action === 'ignore') continue
      if (parseDecimal(d.quantity) <= 0) {
        map.set(d.key, 'Quantidade precisa ser maior que zero.')
        continue
      }
      if (d.action === 'link' && !d.ingredientId) {
        map.set(d.key, 'Escolha o insumo a vincular.')
        continue
      }
      if (d.action === 'create') {
        if (d.newName.trim().length < 2) {
          map.set(d.key, 'Nome do novo insumo é obrigatório.')
          continue
        }
        if (!d.newUnit.trim()) {
          map.set(d.key, 'Unidade do novo insumo é obrigatória.')
        }
      }
    }
    return map
  }, [drafts])

  const handleSave = async () => {
    setSaveError(null)

    if (included.length === 0) {
      setSaveError('Nenhum item selecionado. Marque ao menos um item para dar entrada.')
      return
    }
    if (problemas.size > 0) {
      setSaveError(
        `${problemas.size} item(ns) com pendência. Corrija os campos destacados antes de confirmar.`,
      )
      return
    }

    const items: StockEntryItem[] = included.map((d) => {
      const quantity = parseDecimal(d.quantity)
      const unitPrice = parseDecimal(d.unitPrice)

      if (d.action === 'link') {
        return {
          action: 'link',
          ingredientId: d.ingredientId,
          codigo: d.codigo || undefined,
          descricao: d.descricao || undefined,
          quantity,
          unitPrice,
        }
      }
      return {
        action: 'create',
        name: d.newName.trim(),
        unit: d.newUnit.trim(),
        barcode: d.newBarcode.trim() || null,
        codigo: d.codigo || undefined,
        descricao: d.descricao || d.newName.trim(),
        quantity,
        unitPrice,
      }
    })

    setSaving(true)
    try {
      const result = await apiPost<StockEntryResult>('/api/scanner/stock-entry', {
        chaveAcesso: nota.chave,
        emitente: nota.emitente ?? undefined,
        emitenteCnpj: nota.emitenteCnpj || undefined,
        emitenteUF: nota.uf || undefined,
        numero: nota.numero || undefined,
        serie: nota.serie || undefined,
        dataEmissao: nota.dataEmissao ?? undefined,
        // O total enviado e o CONFERIDO, nao o da nota: se o usuario ignorou um
        // item, gravar o total original deixaria a nota inconsistente com as
        // entradas que ela gerou.
        valorTotal: Number(somaItens.toFixed(2)),
        items,
      })
      onSaved(result)
    } catch (err) {
      setSaveError(errorMessage(err, 'Não consegui gravar a entrada de estoque.'))
    } finally {
      setSaving(false)
    }
  }

  const dataFormatada = nota.dataEmissao
    ? new Date(nota.dataEmissao).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <section aria-labelledby="review-title" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="review-title" className="text-xl font-semibold text-ink">
            Conferir antes de dar entrada
          </h2>
          <p className="text-sm text-slate">
            Nada foi gravado ainda. Ajuste o que precisar e confirme no fim.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-canvas"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Voltar
        </button>
      </header>

      {/* Nota ja importada vem ANTES de tudo: revisar 30 itens para so no fim
          descobrir que a compra ja foi lancada e trabalho jogado fora. */}
      {nota.alreadyImported && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-lg border border-bad/40 bg-bad-soft p-4"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-bad">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            Esta nota já foi importada
          </p>
          <p className="text-sm text-bad/90">
            {nota.alreadyImported.sameTenant
              ? `Importada em ${new Date(nota.alreadyImported.importedAt).toLocaleString('pt-BR')}. Se confirmar de novo, o servidor vai recusar para não duplicar o estoque.`
              : 'Esta nota foi importada em outra loja. O servidor vai recusar a gravação.'}
          </p>
        </div>
      )}

      {nota.warning && (
        <p
          role="status"
          className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn"
        >
          {nota.warning}
        </p>
      )}

      {/* -- Cabecalho da nota ------------------------------------------------ */}
      <article className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-ink">
            {nota.emitente ?? 'Emitente não identificado'}
          </h3>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              nota.source === 'sefaz'
                ? 'bg-good-soft text-good'
                : 'bg-warn-soft text-warn'
            }`}
          >
            {nota.source === 'sefaz' ? 'Itens lidos da SEFAZ' : 'Itens não lidos — lançamento manual'}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div className="flex flex-col">
            <dt className="text-slate">CNPJ</dt>
            <dd className="font-mono text-ink">{nota.emitenteCnpj || '—'}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-slate">Nota / série</dt>
            <dd className="font-mono text-ink">
              {nota.numero} / {nota.serie}
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-slate">Emissão</dt>
            <dd className="text-ink">{dataFormatada ?? '—'}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-slate">Total da nota</dt>
            <dd className="font-mono font-semibold text-ink">
              {nota.valorTotal != null ? brl(nota.valorTotal) : '—'}
            </dd>
          </div>
        </dl>

        <p className="break-all font-mono text-xs text-slate">Chave: {nota.chave}</p>
      </article>

      {/* -- Itens ------------------------------------------------------------ */}
      <div className="flex flex-col gap-3">
        {drafts.length === 0 && (
          <p className="rounded-lg border border-dashed border-line bg-surface p-6 text-center text-sm text-slate">
            Nenhum item veio da consulta. Use &quot;Adicionar item&quot; para lançar a
            compra manualmente.
          </p>
        )}

        {drafts.map((d, index) => {
          const problema = problemas.get(d.key)
          const ignorado = d.action === 'ignore'
          const q = parseDecimal(d.quantity)
          const p = parseDecimal(d.unitPrice)

          return (
            <article
              key={d.key}
              className={`flex flex-col gap-3 rounded-lg border p-4 transition-colors ${
                problema
                  ? 'border-bad/40 bg-bad-soft/40'
                  : ignorado
                    ? 'border-line bg-canvas opacity-60'
                    : 'border-line bg-surface'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <h4 className="text-sm font-semibold text-ink">
                    {index + 1}. {d.descricao || d.newName || 'Item novo'}
                  </h4>
                  {d.codigo && (
                    <p className="font-mono text-xs text-slate">Código: {d.codigo}</p>
                  )}
                </div>

                {/* A sugestao e mostrada com peso diferente conforme a origem. */}
                {d.matchedBy === 'barcode' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-good-soft px-2.5 py-1 text-xs font-semibold text-good">
                    <Barcode aria-hidden="true" className="h-3.5 w-3.5" />
                    Código de barras confere
                  </span>
                )}
                {d.matchedBy === 'nome' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">
                    <CircleHelp aria-hidden="true" className="h-3.5 w-3.5" />
                    Palpite por nome ({Math.round(d.confidence * 100)}%) — confira
                  </span>
                )}
                {d.matchedBy === null && d.descricao && (
                  <span className="rounded-full bg-canvas px-2.5 py-1 text-xs font-semibold text-slate">
                    Sem correspondência no cadastro
                  </span>
                )}
              </div>

              {/* Acao do item */}
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">O que fazer com o item {index + 1}</legend>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['link', 'Vincular'],
                      ['create', 'Criar novo'],
                      ['ignore', 'Ignorar'],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                        d.action === value
                          ? 'border-brand bg-brand-soft text-brand-strong'
                          : 'border-line bg-surface text-slate hover:bg-canvas'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`action-${d.key}`}
                        value={value}
                        checked={d.action === value}
                        onChange={() => patch(d.key, { action: value })}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {!ignorado && (
                <>
                  {d.action === 'link' ? (
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={`ing-${d.key}`}
                        className="text-xs font-medium text-slate"
                      >
                        Insumo do cadastro
                      </label>
                      <select
                        id={`ing-${d.key}`}
                        value={d.ingredientId}
                        onChange={(e) => patch(d.key, { ingredientId: e.target.value })}
                        className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                      >
                        <option value="">
                          {loadingIngredients ? 'Carregando insumos...' : 'Selecione o insumo'}
                        </option>
                        {/* O sugerido aparece mesmo se a lista falhar em carregar. */}
                        {d.ingredientId &&
                          !ingredients.some((i) => i.id === d.ingredientId) && (
                            <option value={d.ingredientId}>
                              {d.matchName} (sugerido)
                            </option>
                          )}
                        {ingredients.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} — {qty(Number(i.stock))} {i.unit}
                          </option>
                        ))}
                      </select>
                      {d.ingredientId && (
                        <p className="text-xs text-slate">
                          Estoque atual {qty(d.matchStock)} → depois da entrada{' '}
                          <strong className="text-ink">{qty(d.matchStock + q)}</strong>
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <label
                          htmlFor={`name-${d.key}`}
                          className="text-xs font-medium text-slate"
                        >
                          Nome do novo insumo
                        </label>
                        <input
                          id={`name-${d.key}`}
                          value={d.newName}
                          onChange={(e) => patch(d.key, { newName: e.target.value })}
                          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor={`barcode-${d.key}`}
                          className="text-xs font-medium text-slate"
                        >
                          Código de barras
                        </label>
                        <input
                          id={`barcode-${d.key}`}
                          value={d.newBarcode}
                          onChange={(e) => patch(d.key, { newBarcode: e.target.value })}
                          placeholder="opcional"
                          className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink"
                        />
                      </div>
                    </div>
                  )}

                  {/* Quantidade, unidade e preco: sempre editaveis, em qualquer
                      acao. A nota traz o que o supermercado registrou, nao
                      necessariamente o que entrou no deposito. */}
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={`qty-${d.key}`}
                        className="text-xs font-medium text-slate"
                      >
                        Quantidade
                      </label>
                      <input
                        id={`qty-${d.key}`}
                        value={d.quantity}
                        onChange={(e) => patch(d.key, { quantity: e.target.value })}
                        inputMode="decimal"
                        className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={`unit-${d.key}`}
                        className="text-xs font-medium text-slate"
                      >
                        Unidade
                      </label>
                      <input
                        id={`unit-${d.key}`}
                        value={d.newUnit}
                        onChange={(e) => patch(d.key, { newUnit: e.target.value })}
                        disabled={d.action === 'link'}
                        title={
                          d.action === 'link'
                            ? 'Ao vincular, a unidade usada é a do insumo cadastrado.'
                            : undefined
                        }
                        className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink disabled:bg-canvas disabled:text-slate"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={`price-${d.key}`}
                        className="text-xs font-medium text-slate"
                      >
                        Preço unitário
                      </label>
                      <input
                        id={`price-${d.key}`}
                        value={d.unitPrice}
                        onChange={(e) => patch(d.key, { unitPrice: e.target.value })}
                        inputMode="decimal"
                        className="rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-slate">Total do item</span>
                      <output className="rounded-md bg-canvas px-3 py-2 font-mono text-sm font-semibold text-ink">
                        {brl(q * p)}
                      </output>
                    </div>
                  </div>
                </>
              )}

              {problema && (
                <p role="alert" className="text-xs font-semibold text-bad">
                  {problema}
                </p>
              )}

              {/* Remover so faz sentido em item adicionado a mao; os da nota se
                  marcam como "Ignorar", preservando o que a nota dizia. */}
              {!d.descricao && (
                <button
                  type="button"
                  onClick={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))}
                  className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-bad hover:underline"
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                  Remover linha
                </button>
              )}
            </article>
          )
        })}

        <button
          type="button"
          onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}
          className="inline-flex w-fit items-center gap-2 rounded-md border border-dashed border-line bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-canvas"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Adicionar item
        </button>
      </div>

      {/* -- Fechamento ------------------------------------------------------- */}
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-slate">Itens a lançar:</dt>
            <dd className="font-semibold text-ink">{included.length}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate">Soma conferida:</dt>
            <dd className="font-mono font-semibold text-ink">{brl(somaItens)}</dd>
          </div>
          {totalNota > 0 && (
            <div className="flex gap-2">
              <dt className="text-slate">Total da nota:</dt>
              <dd className="font-mono text-ink">{brl(totalNota)}</dd>
            </div>
          )}
        </dl>

        {divergente && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              A soma conferida está {divergencia > 0 ? 'acima' : 'abaixo'} do total da nota
              em {brl(Math.abs(divergencia))}. Se você ignorou algum item, isso é
              esperado. Se não, confira as quantidades antes de confirmar.
            </span>
          </p>
        )}

        {saveError && (
          <p
            role="alert"
            className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad"
          >
            {saveError}
          </p>
        )}

        {canSave ? (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || included.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                Gravando...
              </>
            ) : (
              <>
                <Save aria-hidden="true" className="h-4 w-4" />
                Confirmar entrada de {included.length} item(ns)
              </>
            )}
          </button>
        ) : (
          <p className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-slate">
            Você pode conferir a nota, mas dar entrada no estoque exige a permissão
            <strong className="text-ink"> gerenciar insumos</strong>. Peça a um
            responsável para concluir.
          </p>
        )}
      </div>
    </section>
  )
}

/** Recibo do que foi gravado — fecha o ciclo mostrando o efeito real no estoque. */
export function StockEntrySummary({
  result,
  onDone,
}: {
  result: StockEntryResult
  onDone: () => void
}) {
  return (
    <section aria-labelledby="summary-title" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2
          id="summary-title"
          className="flex items-center gap-2 text-xl font-semibold text-ink"
        >
          <Check aria-hidden="true" className="h-5 w-5 text-good" />
          Entrada registrada
        </h2>
        <p className="text-sm text-slate">
          {result.itemsApplied} item(ns) lançados
          {result.createdIngredients > 0
            ? `, ${result.createdIngredients} insumo(s) novo(s) cadastrado(s)`
            : ''}
          .
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {result.details.map((d) => (
          <li
            key={d.ingredientId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-4 py-3"
          >
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-ink">{d.name}</span>
              {d.createdIngredient && (
                <span className="text-xs font-medium text-good">Insumo novo</span>
              )}
            </div>
            <span className="font-mono text-sm text-slate">
              {qty(d.before)} → <strong className="text-ink">{qty(d.after)}</strong> {d.unit}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onDone}
        className="inline-flex w-fit items-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
      >
        Escanear outra nota
      </button>
    </section>
  )
}

export default NfceReview
