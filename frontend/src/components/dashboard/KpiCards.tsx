/**
 * Os quatro cartoes do topo da Visao geral.
 *
 * Cada cartao carrega TRES informacoes em ordem de importancia: o valor de hoje
 * (grande), a variacao (colorida) e a base de comparacao de ontem (pequena e
 * cinza). A base existe porque "+12,4%" sozinho nao e verificavel — o dono
 * precisa ver de que numero veio, senao o painel pede fe em vez de informar.
 */
import { ArrowDown, ArrowUp, Minus, Receipt, ShoppingBag, TrendingUp, Wallet } from 'lucide-react'
import { brl, variation, type DaySummary } from './types'

interface Props {
  today: DaySummary
  yesterday: DaySummary
}

interface Metric {
  key: string
  label: string
  icon: typeof Wallet
  value: string
  previous: string
  delta: number | null
  /**
   * Se subir e bom. Todos os quatro sao "quanto mais, melhor" hoje, mas o campo
   * fica explicito para o dia em que entrar um KPI invertido (tempo de entrega,
   * taxa de cancelamento) e ninguem precisar reler a logica de cor.
   */
  higherIsBetter: boolean
}

/**
 * Escreve a variacao do jeito que se le em voz alta.
 *
 * Acima de 10x a porcentagem deixa de informar: verificando no navegador, um dia
 * de teste apos um dia com um unico pedido de R$ 7,80 rendeu "+25401,3%", que
 * ninguem consegue interpretar. Nesses casos o multiplicador ("25x ontem") diz a
 * mesma coisa de forma legivel — e a base de ontem continua ao lado, no cartao.
 */
function formatDelta(delta: number | null): string {
  if (delta === null) return 'sem base'

  const magnitude = Math.abs(delta)
  if (magnitude >= 1000) {
    // delta% = (hoje - ontem) / ontem * 100, logo hoje/ontem = 1 + delta/100.
    const times = 1 + magnitude / 100
    return `${times.toFixed(0)}x ${delta >= 0 ? 'ontem' : 'menor'}`
  }

  return `${delta >= 0 ? '' : '-'}${magnitude.toFixed(1).replace('.', ',')}%`
}

export function KpiCards({ today, yesterday }: Props) {
  const metrics: Metric[] = [
    {
      key: 'revenue',
      label: 'Faturamento',
      icon: Wallet,
      value: brl(today.revenue),
      previous: brl(yesterday.revenue),
      delta: variation(today.revenue, yesterday.revenue),
      higherIsBetter: true,
    },
    {
      key: 'orders',
      label: 'Pedidos',
      icon: ShoppingBag,
      value: String(today.orders),
      previous: String(yesterday.orders),
      delta: variation(today.orders, yesterday.orders),
      higherIsBetter: true,
    },
    {
      key: 'ticket',
      label: 'Ticket médio',
      icon: Receipt,
      value: brl(today.averageTicket),
      previous: brl(yesterday.averageTicket),
      delta: variation(today.averageTicket, yesterday.averageTicket),
      higherIsBetter: true,
    },
    {
      key: 'profit',
      label: 'Lucro estimado',
      icon: TrendingUp,
      value: brl(today.estimatedProfit),
      previous: brl(yesterday.estimatedProfit),
      delta: variation(today.estimatedProfit, yesterday.estimatedProfit),
      higherIsBetter: true,
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(({ key, label, icon: Icon, value, previous, delta, higherIsBetter }) => {
        const good = delta === null ? null : higherIsBetter ? delta >= 0 : delta <= 0
        const DeltaIcon = delta === null ? Minus : delta >= 0 ? ArrowUp : ArrowDown

        return (
          <article
            key={key}
            className="flex items-start gap-3.5 rounded-card border border-line bg-surface p-4 shadow-sm"
          >
            {/* Dourado como PREENCHIMENTO do icone, com o vinho por cima: o
                dourado nunca escreve. */}
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink"
            >
              <Icon className="h-5 w-5" />
            </span>

            <div className="min-w-0">
              <p className="text-sm font-medium text-slate">{label}</p>
              <p className="font-display text-2xl leading-tight text-plum tabular-nums">{value}</p>

              <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-xs">
                <span
                  className={`inline-flex items-center gap-0.5 font-semibold ${
                    good === null ? 'text-slate' : good ? 'text-good' : 'text-bad'
                  }`}
                >
                  <DeltaIcon aria-hidden="true" className="h-3 w-3" />
                  {formatDelta(delta)}
                </span>
                <span className="text-slate">vs. ontem ({previous})</span>
              </p>
            </div>
          </article>
        )
      })}
    </div>
  )
}
