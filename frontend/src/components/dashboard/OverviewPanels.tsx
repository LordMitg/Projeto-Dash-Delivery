/**
 * Os tres paineis da faixa de baixo: pedidos em andamento, produtos mais
 * vendidos e alertas.
 *
 * Ficam juntos num arquivo porque compartilham a mesma moldura (`Panel`) e a
 * mesma regra de leitura: cada um mostra no maximo cinco linhas e termina num
 * link para a tela completa. Cinco e o que cabe sem rolagem interna — painel de
 * resumo que rola por dentro esconde justamente o que deveria resumir.
 */
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  ImageOff,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react'
import {
  brl,
  STATUS_LABEL,
  STATUS_TONE,
  type InProgressOrder,
  type OverviewAlerts,
  type TopProduct,
} from './types'

/** Moldura comum: titulo, atalho no topo e rodape com link. */
function Panel({
  id,
  title,
  action,
  footer,
  children,
}: {
  id: string
  title: string
  action?: { label: string; to: string }
  footer?: { label: string; to: string }
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col rounded-card border border-line bg-surface shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 id={id} className="font-display text-base text-plum">
          {title}
        </h2>
        {action && (
          <Link
            to={action.to}
            className="shrink-0 text-xs font-semibold text-accent transition-colors hover:text-plum"
          >
            {action.label}
          </Link>
        )}
      </div>

      <div className="flex-1 px-4 py-3">{children}</div>

      {footer && (
        <Link
          to={footer.to}
          className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-xs font-semibold text-ink transition-colors hover:bg-canvas"
        >
          {footer.label}
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-slate" />
        </Link>
      )}
    </section>
  )
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate">{children}</p>
}

// ---------------------------------------------------------------------------
// Pedidos em andamento
// ---------------------------------------------------------------------------

export function InProgressPanel({
  orders,
  // O limite de atraso e definido pelo backend (`alerts.lateOrders`), entao
  // chega por prop: repetir "60" aqui abriria espaco para o painel e o alerta
  // discordarem sobre o que esta atrasado.
  lateAfterMinutes,
}: {
  orders: InProgressOrder[]
  lateAfterMinutes: number
}) {
  const visible = orders.slice(0, 5)

  return (
    <Panel
      id="in-progress-title"
      title="Pedidos em andamento"
      action={{ label: 'Ver todos', to: '/pedidos' }}
      footer={{ label: 'Ver todos os pedidos em andamento', to: '/pedidos' }}
    >
      {visible.length === 0 ? (
        <EmptyLine>Nenhum pedido em andamento.</EmptyLine>
      ) : (
        /**
         * Lista de duas faixas por pedido, e nao a tabela de 6 colunas do
         * desenho original. Este painel ocupa cerca de um terco da largura, e
         * verificando no navegador as colunas Total / Tempo / Status ficavam
         * cortadas na borda do cartao — justamente as que respondem "quanto" e
         * "esta atrasado?". Empilhado, tudo caber e sobra espaco para o nome do
         * cliente inteiro.
         */
        <ul className="flex flex-col divide-y divide-line">
          {visible.map((order) => (
            <li key={order.id} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-baseline gap-2 truncate">
                  <span className="font-semibold text-ink tabular-nums">#{order.orderNumber}</span>
                  <span className="truncate text-sm text-ink">
                    {order.customerName ?? 'Sem cadastro'}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">
                  {brl(order.total)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate">
                  <span className="rounded bg-canvas px-1.5 py-0.5 text-xs font-medium text-slate">
                    {order.channel}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                      STATUS_TONE[order.status] ?? 'bg-canvas text-slate'
                    }`}
                  >
                    {STATUS_LABEL[order.status] ?? order.status}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-xs tabular-nums ${
                    order.minutes >= lateAfterMinutes ? 'font-semibold text-bad' : 'text-slate'
                  }`}
                >
                  {order.minutes} min
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Mais vendidos
// ---------------------------------------------------------------------------

export function TopProductsPanel({ products }: { products: TopProduct[] }) {
  return (
    <Panel
      id="top-products-title"
      title="Produtos mais vendidos"
      action={{ label: 'Ver relatório', to: '/indicadores' }}
      footer={{ label: 'Ver todos os produtos', to: '/fichas' }}
    >
      {products.length === 0 ? (
        <EmptyLine>Nenhuma venda registrada neste dia.</EmptyLine>
      ) : (
        <ol className="flex flex-col">
          {products.map((product, index) => (
            <li
              key={product.id}
              className="flex items-center gap-3 border-t border-line py-2 first:border-t-0 first:pt-0"
            >
              <span className="w-3 shrink-0 text-xs font-semibold text-slate tabular-nums">
                {index + 1}
              </span>

              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-md border border-line object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-canvas text-slate"
                >
                  <ImageOff className="h-4 w-4" />
                </span>
              )}

              <span className="min-w-0 flex-1 truncate text-sm text-ink">{product.name}</span>

              <span className="shrink-0 text-sm font-semibold text-plum tabular-nums">
                {product.quantity}
                <span className="ml-1 text-xs font-normal text-slate">un.</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

interface AlertRow {
  key: string
  icon: LucideIcon
  tone: string
  title: string
  detail: string
  to: string
}

export function AlertsPanel({ alerts }: { alerts: OverviewAlerts }) {
  /**
   * Monta so os alertas que realmente disparam. Um painel que lista as tres
   * categorias sempre — duas delas com "0 itens" — treina o olho a ignorar o
   * bloco inteiro, e o dia em que houver ruptura de estoque o aviso passara
   * batido junto com os zeros.
   */
  const rows: AlertRow[] = []

  if (alerts.lowStock.count > 0) {
    rows.push({
      key: 'low-stock',
      icon: AlertTriangle,
      tone: 'bg-warn-soft text-warn',
      title: 'Estoque baixo',
      detail: `${alerts.lowStock.count} ${
        alerts.lowStock.count === 1 ? 'item' : 'itens'
      } com estoque abaixo do mínimo.`,
      to: '/insumos',
    })
  }

  if (alerts.lateOrders.count > 0) {
    rows.push({
      key: 'late',
      icon: Clock,
      tone: 'bg-bad-soft text-bad',
      title: 'Pedido atrasado',
      detail: `${alerts.lateOrders.count} ${
        alerts.lateOrders.count === 1 ? 'pedido' : 'pedidos'
      } com mais de ${alerts.lateOrders.thresholdMinutes} min sem finalizar.`,
      to: '/pedidos',
    })
  }

  if (alerts.lowMargin.count > 0) {
    rows.push({
      key: 'margin',
      icon: TrendingDown,
      tone: 'bg-bad-soft text-bad',
      title: 'Margem abaixo do ideal',
      detail: `${alerts.lowMargin.count} ${
        alerts.lowMargin.count === 1 ? 'produto' : 'produtos'
      } com margem abaixo de ${alerts.lowMargin.thresholdPerc.toFixed(0)}%.`,
      to: '/precos',
    })
  }

  return (
    <Panel id="alerts-title" title="Alertas inteligentes">
      {rows.length === 0 ? (
        <EmptyLine>Nada exigindo atenção agora.</EmptyLine>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(({ key, icon: Icon, tone, title, detail, to }) => (
            <li key={key}>
              <Link
                to={to}
                className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 transition-colors hover:bg-canvas"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone}`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{title}</span>
                  <span className="block text-xs text-slate">{detail}</span>
                </span>
                <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
