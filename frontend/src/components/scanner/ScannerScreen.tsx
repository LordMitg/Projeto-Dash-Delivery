/**
 * Tela do Scanner: um visor, dois trabalhos.
 *
 * Modo "produto" bipa a embalagem e responde preco e saldo — e o antigo
 * `BarcodeScanner`, agora falando com `/api/scanner/lookup`, que consulta insumo
 * E produto na mesma chamada (a rota antiga so via produto, entao bipar um saco
 * de farinha dizia "nao cadastrado" mesmo com o insumo no sistema).
 *
 * Modo "nota" le o QR da NFC-e e leva para a conferencia. Nada e gravado aqui:
 * a tela de conferencia e obrigatoria, sempre.
 *
 * Por que um componente com dois modos em vez de duas telas: a camera e o
 * recurso caro e chato de gerenciar. Um visor unico, montado uma vez, evita duas
 * implementacoes divergindo — e no celular o operador troca de tarefa sem sair
 * da pagina.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Barcode,
  Check,
  FileText,
  Loader2,
  PackageSearch,
  ReceiptText,
  Search,
} from 'lucide-react'

import { apiGet, apiPost, errorMessage } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { CameraFeed } from './CameraFeed'
import { NfceReview, StockEntrySummary } from './NfceReview'
import { extractAccessKey, looksLikeNfce } from '../../lib/nfceKey'
import type { LookupResult, NfceResult, StockEntryResult } from './types'
import type { BarcodeFormat } from 'barcode-detector/ponyfill'

/** Formatos por modo. Restringir ajuda o detector e evita leitura cruzada. */
const BARCODE_FORMATS: BarcodeFormat[] = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
]
const QR_FORMATS: BarcodeFormat[] = ['qr_code']

type Mode = 'produto' | 'nota'
/** Etapas do modo nota: ler -> conferir -> recibo. */
type NotaStep = 'scan' | 'review' | 'done'

function brl(value: number | string): string {
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`
}

function qty(value: number | string): string {
  const n = Number(value)
  // Insumo fracionado (0,156 kg) perde o sentido arredondado para inteiro, mas
  // "12,000 un" tambem incomoda. Mostra decimais so quando existem.
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace('.', ',')
}

export function ScannerScreen() {
  const { can } = useAuth()
  // Consultar e inofensivo; gravar estoque nao. O servidor exige
  // `ingredients:manage` na gravacao — refletir isso aqui evita oferecer um
  // botao que responderia 403.
  const canSave = can('ingredients:manage')

  const [mode, setMode] = useState<Mode>('produto')
  const [resetToken, setResetToken] = useState(0)

  // -- Modo produto --------------------------------------------------------
  const [manualCode, setManualCode] = useState('')
  const [lookup, setLookup] = useState<LookupResult | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  // -- Modo nota -----------------------------------------------------------
  const [notaStep, setNotaStep] = useState<NotaStep>('scan')
  const [manualKey, setManualKey] = useState('')
  const [nota, setNota] = useState<NfceResult | null>(null)
  const [notaError, setNotaError] = useState<string | null>(null)
  const [loadingNota, setLoadingNota] = useState(false)
  const [entry, setEntry] = useState<StockEntryResult | null>(null)

  // Uma requisicao lenta que retorna DEPOIS de o usuario ter bipado outra coisa
  // sobrescreveria a tela com um resultado velho. O contador descarta respostas
  // que nao sao mais as mais recentes.
  const requestSeq = useRef(0)

  const runLookup = useCallback(async (code: string) => {
    const clean = code.trim()
    if (!clean) return

    const seq = ++requestSeq.current
    setSearching(true)
    setLookupError(null)

    try {
      const result = await apiGet<LookupResult>('/api/scanner/lookup', { code: clean })
      if (seq !== requestSeq.current) return
      setLookup(result)
      if (!result.found) {
        setLookupError(`Código ${clean} não está cadastrado como insumo nem como produto.`)
      }
    } catch (err) {
      if (seq !== requestSeq.current) return
      setLookup(null)
      setLookupError(errorMessage(err))
    } finally {
      if (seq === requestSeq.current) setSearching(false)
    }
  }, [])

  const runNfce = useCallback(async (qr: string) => {
    const raw = qr.trim()
    if (!raw) return

    const seq = ++requestSeq.current
    setLoadingNota(true)
    setNotaError(null)

    try {
      const result = await apiPost<NfceResult>('/api/scanner/nfce', { qr: raw })
      if (seq !== requestSeq.current) return
      setNota(result)
      setNotaStep('review')
    } catch (err) {
      if (seq !== requestSeq.current) return
      setNota(null)
      setNotaError(errorMessage(err))
    } finally {
      if (seq === requestSeq.current) setLoadingNota(false)
    }
  }, [])

  /**
   * Um QR de nota lido no modo produto seria buscado como codigo de barras e
   * daria "nao cadastrado" — confuso, porque a leitura funcionou. Aqui a tela
   * troca de modo sozinha e ja consulta a nota.
   */
  const handleDetect = useCallback(
    (value: string) => {
      if (mode === 'produto') {
        if (looksLikeNfce(value)) {
          setMode('nota')
          setNotaStep('scan')
          void runNfce(value)
          return
        }
        void runLookup(value)
        return
      }
      void runNfce(value)
    },
    [mode, runLookup, runNfce],
  )

  // Trocar de modo limpa o resultado do outro: manter na tela um preco de
  // produto enquanto o operador ja esta lendo uma nota convida a erro de leitura.
  useEffect(() => {
    setLookupError(null)
    setNotaError(null)
    // Invalida requisicoes em curso do modo anterior.
    requestSeq.current += 1
    setSearching(false)
    setLoadingNota(false)
  }, [mode])

  const rescan = useCallback(() => {
    setLookup(null)
    setLookupError(null)
    // Faz a camera esquecer o ultimo codigo, permitindo reler o MESMO item.
    setResetToken((t) => t + 1)
  }, [])

  const busy = mode === 'produto' ? searching : loadingNota

  // -- Recibo --------------------------------------------------------------
  if (mode === 'nota' && notaStep === 'done' && entry) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
        <StockEntrySummary
          result={entry}
          onDone={() => {
            setEntry(null)
            setNota(null)
            setNotaStep('scan')
            setResetToken((t) => t + 1)
          }}
        />
      </div>
    )
  }

  // -- Conferencia ---------------------------------------------------------
  if (mode === 'nota' && notaStep === 'review' && nota) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
        <NfceReview
          nota={nota}
          canSave={canSave}
          onCancel={() => {
            setNota(null)
            setNotaStep('scan')
            setResetToken((t) => t + 1)
          }}
          onSaved={(result) => {
            setEntry(result)
            setNotaStep('done')
          }}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-ink">Scanner</h1>
        <p className="text-sm text-slate">
          Bipe a embalagem para ver preço e saldo, ou leia o QR Code da nota fiscal para
          dar entrada na compra.
        </p>
      </header>

      {/* -- Seletor de modo ------------------------------------------------ */}
      <div
        role="tablist"
        aria-label="O que escanear"
        className="flex gap-1 rounded-lg border border-line bg-surface p-1"
      >
        {(
          [
            { id: 'produto', label: 'Código de barras', icon: Barcode },
            { id: 'nota', label: 'Nota fiscal', icon: ReceiptText },
          ] as const
        ).map((tab) => {
          const active = mode === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setMode(tab.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors ${
                active
                  ? 'bg-ink text-white'
                  : 'text-slate hover:bg-canvas hover:text-ink'
              }`}
            >
              <tab.icon aria-hidden="true" className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* -- Visor ---------------------------------------------------------- */}
      <CameraFeed
        formats={mode === 'produto' ? BARCODE_FORMATS : QR_FORMATS}
        onDetect={handleDetect}
        resetToken={resetToken}
        guide={mode === 'produto' ? 'wide' : 'square'}
        hint={
          mode === 'produto'
            ? 'Alinhe o código de barras na faixa'
            : 'Enquadre o QR Code do rodapé da nota'
        }
      />

      {busy && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm font-medium text-slate"
        >
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          {mode === 'produto' ? 'Consultando o cadastro…' : 'Consultando a nota na SEFAZ…'}
        </p>
      )}

      {/* -- Entrada manual ------------------------------------------------- */}
      {mode === 'produto' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void runLookup(manualCode)
            // Limpa apos disparar: sem isso, um leitor USB CONCATENA a leitura
            // seguinte na anterior e a busca nunca encontra nada.
            setManualCode('')
          }}
          className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4"
        >
          <label htmlFor="manual-code" className="text-sm font-medium text-ink">
            Digitar o código
          </label>
          <div className="flex gap-2">
            <input
              id="manual-code"
              value={manualCode}
              // EAN/UPC e numerico: filtrar evita que espaco ou letra de um
              // leitor mal configurado gere uma busca impossivel.
              onChange={(e) => setManualCode(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              autoComplete="off"
              maxLength={14}
              placeholder="7891234567890"
              className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-slate/60 focus:border-brand"
            />
            <button
              type="submit"
              disabled={searching || !manualCode.trim()}
              className="inline-flex shrink-0 items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink-soft disabled:opacity-60"
            >
              <Search aria-hidden="true" className="h-4 w-4" />
              Buscar
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void runNfce(manualKey)
          }}
          className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4"
        >
          <label htmlFor="manual-key" className="text-sm font-medium text-ink">
            Ou cole o endereço do QR Code
          </label>
          {/* Texto medido contra a SEFAZ-BA, nao suposto: a URL do QR carrega um
              hash de assinatura, e e SO com ele que o portal devolve os itens.
              A chave de 44 digitos sozinha cai sempre no captcha. Prometer que
              digitar a chave importa a compra faria o usuario culpar o sistema
              por um limite que e do portal. */}
          <p className="text-xs text-slate">
            O ideal é escanear o QR Code com a câmera. Se preferir colar, use o endereço
            completo do QR — é ele que autoriza a leitura dos itens. Colando somente os
            44 dígitos, a SEFAZ pede captcha e só dá para lançar os itens à mão.
          </p>
          <div className="flex gap-2">
            <input
              id="manual-key"
              value={manualKey}
              // Aceita a URL inteira do QR: `extractAccessKey` separa a chave e o
              // servidor reaproveita o hash da URL, que e o que libera os itens.
              onChange={(e) => setManualKey(e.target.value)}
              // Sem `inputMode="numeric"`: o conteudo esperado e uma URL, e o
              // teclado numerico no celular esconderia ":" e "/".
              autoComplete="off"
              spellCheck={false}
              placeholder="https://nfe.sefaz.ba.gov.br/... ou os 44 dígitos"
              className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-slate/60 focus:border-brand"
            />
            <button
              type="submit"
              disabled={loadingNota || !extractAccessKey(manualKey)}
              className="inline-flex shrink-0 items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink-soft disabled:opacity-60"
            >
              <FileText aria-hidden="true" className="h-4 w-4" />
              Consultar
            </button>
          </div>
          {/* Conta os digitos enquanto digita: descobrir que faltava um numero
              somente depois do erro do servidor e frustrante. */}
          {manualKey.trim() !== '' && !extractAccessKey(manualKey) && (
            <p className="text-xs font-medium text-warn">
              {manualKey.replace(/\D/g, '').length} de 44 dígitos.
            </p>
          )}
        </form>
      )}

      {/* -- Erros ---------------------------------------------------------- */}
      {mode === 'produto' && lookupError && !lookup?.found && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn"
        >
          <PackageSearch aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          {lookupError}
        </p>
      )}

      {mode === 'nota' && notaError && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          {notaError}
        </p>
      )}

      {/* -- Resultado do modo produto -------------------------------------- */}
      {mode === 'produto' && lookup?.found && (
        <section aria-live="polite" className="flex flex-col gap-3">
          {lookup.ingredient && (
            <article className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className="rounded bg-brand-soft px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-strong">
                  Insumo
                </span>
                {!lookup.ingredient.active && (
                  <span className="text-xs font-medium text-slate">inativo</span>
                )}
              </div>
              <h2 className="text-base font-semibold text-ink">{lookup.ingredient.name}</h2>
              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate">
                <div className="flex gap-1.5">
                  <dt>Custo:</dt>
                  <dd className="font-mono text-ink">{brl(lookup.ingredient.price)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt>Estoque:</dt>
                  {/* Saldo zerado ou abaixo do minimo em destaque: lido como
                      numero neutro, o operador promete o que nao tem. */}
                  <dd
                    className={
                      Number(lookup.ingredient.stock) <= 0
                        ? 'font-semibold text-bad'
                        : Number(lookup.ingredient.stock) <= Number(lookup.ingredient.minimumStock)
                          ? 'font-semibold text-warn'
                          : 'font-mono text-ink'
                    }
                  >
                    {qty(lookup.ingredient.stock)} {lookup.ingredient.unit}
                    {Number(lookup.ingredient.stock) <= 0
                      ? ' — sem estoque'
                      : Number(lookup.ingredient.stock) <=
                          Number(lookup.ingredient.minimumStock)
                        ? ' — abaixo do mínimo'
                        : ''}
                  </dd>
                </div>
              </dl>
            </article>
          )}

          {lookup.product && (
            <article className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className="rounded bg-ink/5 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink">
                  Produto
                </span>
                {!lookup.product.active && (
                  <span className="text-xs font-medium text-slate">inativo</span>
                )}
              </div>
              <h2 className="text-base font-semibold text-ink">{lookup.product.name}</h2>
              <p className="font-mono text-lg font-bold text-good">{brl(lookup.product.price)}</p>
            </article>
          )}

          <button
            type="button"
            onClick={rescan}
            className="inline-flex w-fit items-center gap-2 rounded-md border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-canvas"
          >
            <Check aria-hidden="true" className="h-4 w-4 text-good" />
            Escanear outro
          </button>
        </section>
      )}
    </div>
  )
}

export default ScannerScreen
