/**
 * Rateio de pedidos por canal de venda.
 *
 * A legenda fica ao lado, nao dentro do anel, e cada linha traz nome, numero de
 * pedidos e a fatia em %: rotulo dentro de fatia fina some, e o dono precisa
 * comparar canais lendo uma coluna, nao girando a cabeca em volta do circulo.
 *
 * O centro mostra "100% dos pedidos" com o total embaixo — o furo do donut e
 * espaco morto, e ali ele confirma qual universo esta sendo dividido.
 */
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { brl, type ChannelSlice } from './types'

/**
 * Cores das fatias.
 *
 * Aqui a regra de "3 a 5 cores" da identidade encosta num limite real: um donut
 * precisa de uma cor por canal. A saida foi usar a propria familia do sistema em
 * degraus de profundidade (vinho -> dourado -> vinho claro) em vez de importar
 * azul e vermelho como no rascunho. Fica dentro da paleta e as fatias continuam
 * distinguiveis; a partir da sexta o ciclo repete, e por isso a legenda ao lado
 * e obrigatoria, nao decorativa.
 */
const SLICE_COLORS = [
  'var(--color-plum)',
  'var(--color-brand)',
  'var(--color-plum-soft)',
  'var(--color-brand-strong)',
  'var(--color-accent)',
] as const

interface Props {
  channels: ChannelSlice[]
  totalOrders: number
}

export function ChannelDonut({ channels, totalOrders }: Props) {
  /**
   * Canal com mais PEDIDOS — e o que as fatias medem.
   *
   * O backend ordena os canais por faturamento, entao usar o primeiro da lista
   * faria o centro do donut apontar um canal que nao e o da maior fatia
   * desenhada. Comeca em `undefined` (e nao em `channels[0]`) porque com
   * `noUncheckedIndexedAccess` o indice 0 tambem pode nao existir.
   */
  let leader: ChannelSlice | undefined
  for (const channel of channels) {
    if (!leader || channel.orders > leader.orders) leader = channel
  }

  return (
    <section
      aria-labelledby="channels-title"
      className="flex min-w-0 flex-col rounded-card border border-line bg-surface p-4 shadow-sm"
    >
      <h2 id="channels-title" className="font-display text-base text-plum">
        Canais de venda
      </h2>

      {/* A condicao testa o `leader` (e nao um `hasData` separado) para que o
          TypeScript saiba, dentro deste ramo, que existe canal para o centro
          do donut — sem precisar de `!` em nenhum ponto do JSX. */}
      {!leader || totalOrders <= 0 ? (
        <p className="flex flex-1 items-center justify-center py-10 text-center text-sm text-slate">
          Nenhum pedido registrado neste dia.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row">
            <div className="relative h-44 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={channels}
                    dataKey="orders"
                    nameKey="name"
                    innerRadius="62%"
                    outerRadius="100%"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {channels.map((channel, index) => (
                      <Cell
                        key={channel.id}
                        fill={SLICE_COLORS[index % SLICE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`${Number(value)} pedidos`, String(name)]}
                    contentStyle={{
                      borderRadius: 8,
                      border: 'none',
                      backgroundColor: 'var(--color-plum)',
                      color: 'var(--color-cream)',
                      fontSize: 12,
                    }}
                    itemStyle={{ color: 'var(--color-cream)' }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* `pointer-events-none`: sem isso o texto do centro rouba o hover
                  das fatias mais internas e o tooltip pisca. */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                <span className="font-display text-2xl leading-none text-plum tabular-nums">
                  {leader.share.toFixed(0)}%
                </span>
                <span className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-slate">
                  {leader.name}
                </span>
              </div>
            </div>

            <ul className="flex w-full min-w-0 flex-col gap-2.5">
              {channels.map((channel, index) => (
                <li key={channel.id} className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: SLICE_COLORS[index % SLICE_COLORS.length] }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {channel.name}
                    </span>
                    <span className="block text-xs text-slate tabular-nums">
                      {channel.orders} {channel.orders === 1 ? 'pedido' : 'pedidos'} ·{' '}
                      {brl(channel.revenue)}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-plum tabular-nums">
                    {channel.share.toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-3 border-t border-line pt-2 text-xs text-slate">
            Total de <span className="font-semibold tabular-nums">{totalOrders}</span>{' '}
            {totalOrders === 1 ? 'pedido' : 'pedidos'}
          </p>
        </>
      )}
    </section>
  )
}
