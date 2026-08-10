import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'

/**
 * Moldura das telas de porta de entrada (entrar, criar conta, recuperar senha).
 *
 * Existe para as tres telas nao repetirem o painel escuro de marca nem os
 * estilos de campo. O painel escuro a esquerda separa a "porta de entrada" da
 * area de trabalho clara que aparece depois do login.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  /** Conteudo do painel escuro. O padrao vende o produto; telas secundarias
   *  passam algo mais curto, para nao competir com o formulario. */
  aside,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  aside?: ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      <section className="flex flex-col justify-between gap-10 bg-ink px-8 py-10 text-white lg:w-[46%] lg:px-14 lg:py-16">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-md bg-brand text-base font-bold text-white"
          >
            D
          </span>
          <span className="text-sm font-semibold tracking-[0.18em] uppercase">
            Delivery ERP
          </span>
        </div>

        {aside ?? <DefaultAside />}
      </section>

      <section className="flex flex-1 items-center justify-center bg-canvas px-6 py-12 lg:px-14">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-1.5 text-sm text-slate">{subtitle}</p>}
          {children}
          {footer && (
            <div className="mt-8 border-t border-line pt-5 text-xs leading-relaxed text-slate">
              {footer}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

function DefaultAside() {
  return (
    <>
      <div className="flex flex-col gap-6">
        <h1 className="max-w-md text-4xl leading-tight font-semibold text-balance lg:text-5xl">
          O custo de cada prato, calculado antes de você vender.
        </h1>
        <p className="max-w-md text-base leading-relaxed text-white/70">
          Ficha técnica, baixa de estoque por venda e preço sugerido pela margem —
          no mesmo lugar em que o pedido entra.
        </p>
      </div>

      <dl className="flex flex-col gap-4 border-t border-white/10 pt-8">
        {[
          ['CMV por produto', 'com fator de quebra e embalagem'],
          ['Baixa automática', 'a cada pedido confirmado'],
          ['Cardápio digital', 'no link público da loja'],
        ].map(([term, detail]) => (
          <div key={term} className="flex flex-col gap-0.5">
            <dt className="text-sm font-medium text-white">{term}</dt>
            <dd className="text-sm text-white/55">{detail}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

/** Classe unica dos campos, para os tres formularios ficarem identicos. */
export const fieldClass =
  'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none placeholder:text-slate/60 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'

/** Mesma classe, com espaço à esquerda para o ícone. */
export const fieldWithIconClass =
  'w-full rounded-lg border border-line bg-surface py-2.5 pr-3 pl-9 text-sm text-ink outline-none placeholder:text-slate/60 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'

export const primaryButtonClass =
  'flex h-11 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60'

/** Faixa de erro. Usa `role="alert"` para o leitor de tela anunciar na hora. */
export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-bad/30 bg-bad-soft px-3.5 py-3 text-sm text-bad"
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

/** Rótulo + campo, com o espaçamento já padronizado. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate">{hint}</p>}
    </div>
  )
}

/** Link discreto em texto, para alternar entre as telas de entrada. */
export function TextLink({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-medium text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none"
    >
      {children}
    </button>
  )
}
