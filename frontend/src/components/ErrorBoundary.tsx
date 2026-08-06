import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Rede de seguranca da interface.
 *
 * Um erro de render em React desmonta a arvore inteira e deixa a pagina em
 * branco — no meio de um turno, o operador nao tem como saber se o sistema caiu
 * ou se o pedido foi salvo. Aqui o erro vira um painel legivel, com a mensagem
 * tecnica disponivel para relato e um caminho de volta.
 *
 * Precisa ser classe: nao existe equivalente em hooks para `componentDidCatch`.
 */
export class ErrorBoundary extends Component<Props, State> {
  // `override` e exigido pelo `noImplicitOverride` do tsconfig.
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Erro não tratado na interface:', error, info)
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
        <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-7">
          <div className="flex items-center gap-2.5">
            <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0 text-bad" />
            <h1 className="text-lg font-semibold text-ink">
              A tela encontrou um erro
            </h1>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-slate">
            Nada foi perdido: pedidos e estoque só mudam quando o servidor
            confirma. Recarregue para voltar ao sistema. Se o erro repetir,
            envie a mensagem abaixo.
          </p>

          <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-canvas p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-ink">
            {error.message || String(error)}
          </pre>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Recarregar o sistema
          </button>
        </div>
      </div>
    )
  }
}
