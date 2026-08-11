/**
 * Visao geral — a tela que abre o sistema.
 *
 * O que ela responde, em ordem: quanto vendi hoje (KPIs), quando vendi (curva
 * por hora), por onde vendi (canais), o que esta rolando agora (em andamento),
 * o que saiu mais (ranking) e o que precisa da minha atencao (alertas).
 *
 * A rota `/` antes mostrava uma analise de 12 meses. Nao e a pergunta de quem
 * abre o sistema as 11h de um sabado: o historico anual e o que se consulta uma
 * vez por mes, e mudou para `/indicadores`, junto dos outros relatorios.
 *
 * Tudo vem de UMA chamada (`/api/dashboard/overview`) para que os cartoes nunca
 * discordem entre si, e se atualiza sozinho por dois caminhos: os eventos de
 * tempo real (pedido novo, status, cancelamento) e um `refreshInterval` de 60s
 * como rede de seguranca para quando o socket cair.
 */
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { AlertTriangle, CalendarDays, Loader2, Plus, WifiOff } from 'lucide-react'
import { swrFetcher } from '../../lib/api'
import { useRealtime } from '../../hooks/useRealtime'
import { KpiCards } from './KpiCards'
import { SalesChart } from './SalesChart'
import { ChannelDonut } from './ChannelDonut'
import { AlertsPanel, InProgressPanel, TopProductsPanel } from './OverviewPanels'
import type { Overview } from './types'

/** `YYYY-MM-DD` no fuso local (nao `toISOString`, que desloca para UTC). */
function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function OverviewPage() {
  const today = useMemo(() => localDay(new Date()), [])
  const [date, setDate] = useState(today)

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR<Overview>(`/api/dashboard/overview?date=${date}`, swrFetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })

  // Marca do momento em que os dados na tela foram lidos. Guardado em estado (e
  // nao um `new Date()` no render) para nao "andar" a cada re-render e mentir
  // sobre a idade do que esta na tela.
  const [readAt, setReadAt] = useState(() => new Date())

  const refresh = useCallback(async () => {
    await mutate()
    setReadAt(new Date())
  }, [mutate])

  const { status: realtimeStatus } = useRealtime({
    handlers: {
      'order:created': () => void refresh(),
      'order:status': () => void refresh(),
      'order:cancelled': () => void refresh(),
      'stock:low': () => void refresh(),
    },
  })

  const isToday = date === today

  return (
    <section aria-labelledby="overview-title" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="overview-title" className="font-display text-3xl leading-none text-plum">
            Visão geral
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate">
            Acompanhe sua operação em tempo real
            {realtimeStatus === 'connected' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-good-soft px-2 py-0.5 text-xs font-medium text-good">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-good" />
                Ao vivo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
                {realtimeStatus === 'connecting' ? (
                  <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                ) : (
                  <WifiOff aria-hidden="true" className="h-3 w-3" />
                )}
                {realtimeStatus === 'connecting' ? 'Conectando...' : 'Sem conexão ao vivo'}
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* `input[type=date]` nativo em vez de um seletor proprio: o painel
              precisa de um dia, o navegador ja resolve isso com teclado e leitor
              de tela, e um calendario caseiro seria codigo novo para repetir o
              que o sistema operacional faz melhor. */}
          <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink shadow-sm">
            <CalendarDays aria-hidden="true" className="h-4 w-4 text-slate" />
            <span className="sr-only">Dia analisado</span>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(event) => {
                setDate(event.target.value || today)
                setReadAt(new Date())
              }}
              className="bg-transparent text-sm font-medium text-ink outline-none"
            />
          </label>

          <Link
            to="/pdv"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-brand-ink shadow-sm transition-colors hover:bg-brand-strong"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Novo pedido
          </Link>
        </div>
      </header>

      {!isToday && (
        <p className="flex items-start gap-2 rounded-md border border-line bg-brand-soft px-3 py-2 text-sm text-accent">
          <CalendarDays aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          Você está vendo um dia anterior. Os alertas de atraso continuam medindo o tempo até
          agora.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          Não foi possível carregar o painel. Tentando novamente em instantes.
        </p>
      )}

      {isLoading && !data ? (
        <p className="flex items-center gap-2 py-16 text-sm text-slate">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Carregando o painel...
        </p>
      ) : data ? (
        <>
          <KpiCards today={data.kpis.today} yesterday={data.kpis.yesterday} />

          {/* Curva e donut na mesma faixa: sao a mesma pergunta ("de onde veio o
              faturamento de hoje") por dois cortes, tempo e origem. */}
          <div className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
            <SalesChart data={data.hourly} updatedAt={readAt} onRefresh={() => void refresh()} />
            <ChannelDonut channels={data.channels} totalOrders={data.kpis.today.orders} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <InProgressPanel
              orders={data.inProgress}
              lateAfterMinutes={data.alerts.lateOrders.thresholdMinutes}
            />
            <TopProductsPanel products={data.topProducts} />
            {/* No tablet (2 colunas) os alertas ficariam sozinhos na terceira
                linha; ocupar as duas colunas evita meio cartao pendurado. */}
            <div className="lg:col-span-2 xl:col-span-1">
              <AlertsPanel alerts={data.alerts} />
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}

export default OverviewPage
