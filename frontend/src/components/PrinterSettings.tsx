/**
 * Ajuste da impressora: largura da bobina + impressao de teste.
 *
 * A largura fica no `localStorage` e nao no banco de propósito: ela e uma
 * caracteristica do BALCAO, nao da loja. O tablet da cozinha pode ter uma
 * termica de 80mm e o do caixa uma de 58mm, na mesma loja — se isso viesse do
 * servidor, um ajuste em um dispositivo desconfiguraria o outro.
 *
 * O botao de teste existe para calibrar antes de vender: descobrir que a
 * comanda sai cortada no meio da primeira venda do dia e caro.
 */
import { useState } from 'react'
import { Check, Loader2, Printer } from 'lucide-react'
import {
  getPaperWidth,
  setPaperWidth,
  usePrinter,
  type PaperWidth,
} from '../hooks/usePrinter'

const OPTIONS: { value: PaperWidth; label: string; hint: string }[] = [
  { value: '80mm', label: '80mm', hint: 'Bobina padrão da maioria das térmicas' },
  { value: '58mm', label: '58mm', hint: 'Bobina estreita, comum em impressoras portáteis' },
]

export function PrinterSettings() {
  const { testPrint } = usePrinter()
  const [width, setWidth] = useState<PaperWidth>(() => getPaperWidth())
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  function choose(value: PaperWidth) {
    setPaperWidth(value)
    setWidth(value)
    setResult(null)
  }

  async function runTest() {
    setTesting(true)
    setResult(null)
    const r = await testPrint()
    setTesting(false)
    setResult(
      r.success
        ? 'Cupom enviado para a impressora.'
        : 'A impressão não foi concluída. Verifique a impressora e tente de novo.',
    )
  }

  return (
    <section aria-labelledby="printer-title" className="flex max-w-2xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 id="printer-title" className="text-xl font-semibold text-ink">
          Impressora
        </h2>
        <p className="text-sm text-slate">
          A largura vale apenas para este dispositivo. Cada balcão pode ter a sua.
        </p>
      </header>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-medium text-ink">Largura da bobina</legend>

        {OPTIONS.map((opt) => {
          const active = width === opt.value
          return (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                active ? 'border-brand bg-brand-soft' : 'border-line hover:bg-canvas'
              }`}
            >
              {/* `shrink-0` no input e `flex-1` no texto: sem isso o radio era
                  esticado pelo flex e abria um vao enorme ate o rotulo. */}
              <input
                type="radio"
                name="paper-width"
                value={opt.value}
                checked={active}
                onChange={() => choose(opt.value)}
                className="mt-1 h-4 w-4 shrink-0 accent-brand"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-semibold text-ink">{opt.label}</span>
                <span className="text-sm text-slate">{opt.hint}</span>
              </span>
              {active && (
                <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              )}
            </label>
          )
        })}
      </fieldset>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <p className="text-sm text-slate">
          Imprima um cupom de teste para conferir se o texto cabe na bobina antes de
          fechar a primeira venda.
        </p>
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={testing}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
        >
          {testing ? (
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <Printer aria-hidden="true" className="h-4 w-4" />
          )}
          {testing ? 'Imprimindo...' : 'Imprimir teste'}
        </button>
        {result && (
          <p aria-live="polite" className="text-sm text-ink">
            {result}
          </p>
        )}
      </div>
    </section>
  )
}

export default PrinterSettings
