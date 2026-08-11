/**
 * Vendas de hoje: faturamento em barras e pedidos em linha, hora a hora.
 *
 * Duas escalas no mesmo grafico porque as grandezas nao se comparam — R$ 1.500
 * e 30 pedidos na mesma regua achatariam a linha de pedidos contra o eixo. Sao
 * eixos irmaos: barras a esquerda (dinheiro), linha a direita (contagem).
 *
 * O tooltip e proprio, e nao o padrao do Recharts, porque o padrao escreve os
 * numeros crus ("742.8") e monta a caixa com o tema branco dele. Aqui o dinheiro
 * sai formatado em reais e a caixa usa o vinho do sistema.
 */
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { brl, type HourPoint } from './types'

/** Cores vindas dos tokens: SVG aceita `var(--x)` em fill/stroke. */
const CHART = {
  revenue: 'var(--color-plum)',
  orders: 'var(--color-brand)',
  grid: 'var(--color-line)',
  axis: 'var(--color-slate)',
} as const

interface Props {
  data: HourPoint[]
  /** Momento da ultima leitura, para o rodape "Última atualização". */
  updatedAt: Date
  onRefresh: () => void
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}h`

interface TooltipPayloadEntry {
  dataKey?: string | number
  value?: number | string
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: number
}) {
  if (!active || !payload?.length) return null
  const revenue = Number(payload.find((p) => p.dataKey === 'revenue')?.value ?? 0)
  const orders = Number(payload.find((p) => p.dataKey === 'orders')?.value ?? 0)

  return (
    <div className="rounded-lg bg-plum px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-cream">{hourLabel(Number(label ?? 0))}</p>
      <p className="flex items-center justify-between gap-4 text-cream/85">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-cream" />
          Faturamento
        </span>
        <span className="font-semibold tabular-nums">{brl(revenue)}</span>
      </p>
      <p className="flex items-center justify-between gap-4 text-cream/85">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand" />
          Pedidos
        </span>
        <span className="font-semibold tabular-nums">{orders}</span>
      </p>
    </div>
  )
}

export function SalesChart({ data, updatedAt, onRefresh }: Props) {
  return (
    <section
      aria-labelledby="sales-chart-title"
      className="flex min-w-0 flex-col rounded-card border border-line bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="sales-chart-title" className="font-display text-base text-plum">
          Vendas de hoje
        </h2>

        {/* Legenda manual: a do Recharts fica centralizada abaixo do grafico e
            longe do titulo, onde o olho nao a procura. */}
        <p className="flex items-center gap-3 text-xs text-slate">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-plum" />
            Faturamento (R$)
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full bg-brand" />
            Pedidos
          </span>
        </p>
      </div>

      <div className="mt-3 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="hour"
              tickFormatter={hourLabel}
              // Um rotulo a cada 3 horas: 24 rotulos se sobrepoem e ficam
              // ilegiveis na largura de um cartao.
              interval={2}
              tick={{ fontSize: 11, fill: CHART.axis }}
              stroke={CHART.grid}
              tickLine={false}
            />
            <YAxis
              yAxisId="money"
              tickFormatter={(v: number) => `R$ ${v.toLocaleString('pt-BR')}`}
              tick={{ fontSize: 11, fill: CHART.axis }}
              stroke={CHART.grid}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <YAxis
              yAxisId="count"
              orientation="right"
              tick={{ fontSize: 11, fill: CHART.axis }}
              stroke={CHART.grid}
              tickLine={false}
              axisLine={false}
              width={32}
              allowDecimals={false}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: 'var(--color-canvas)' }}
              // Sem isso o cursor de barra fica por cima do ponto da linha e o
              // usuario perde de vista o valor que esta lendo.
              wrapperStyle={{ outline: 'none' }}
            />
            <Bar
              yAxisId="money"
              dataKey="revenue"
              fill={CHART.revenue}
              radius={[3, 3, 0, 0]}
              maxBarSize={18}
              name="Faturamento"
            />
            <Line
              yAxisId="count"
              type="monotone"
              dataKey="orders"
              stroke={CHART.orders}
              strokeWidth={2}
              dot={{ r: 2.5, fill: CHART.orders, strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              name="Pedidos"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-2 flex items-center gap-1.5 border-t border-line pt-2 text-xs text-slate">
        Última atualização:{' '}
        <span className="tabular-nums">
          {updatedAt.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="ml-1 rounded px-1 font-medium text-accent transition-colors hover:text-plum"
        >
          Atualizar
        </button>
      </p>
    </section>
  )
}
