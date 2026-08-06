import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { useTenant } from '../context/TenantContext';
import { PageHeader, Card } from './Layout';
import { apiGet, errorMessage } from '../lib/api';

/**
 * Cores dos graficos vindas dos tokens do tema, nao de hex solto.
 *
 * O Recharts renderiza SVG, e `fill`/`stroke` de SVG aceitam `var(--x)` — logo
 * dava para apontar direto para os tokens. Antes o arquivo usava #3b82f6 e
 * #10b981, azul e verde que nao existem na paleta: o dashboard ficava com duas
 * cores a mais que o resto do sistema.
 */
const CHART = {
  revenue: 'var(--color-brand)',
  costs: 'var(--color-bad)',
  profit: 'var(--color-good)',
  grid: 'var(--color-line)',
  axis: 'var(--color-slate)',
} as const;

interface MonthlyData {
  month: string;
  revenue: number;
  costs: number;
  profit: number;
}

interface CustomerGrowthData {
  month: string;
  customers: number;
  sales: number;
}

/** Resposta de `GET /api/financial/dre`. */
interface DreResponse {
  revenue: number;
  cogs: number;
  expenses: number;
  netIncome: number;
  orderCount: number;
  activeCustomers: number;
}

export const DashboardCharts: React.FC = () => {
  const { activeTenant } = useTenant();
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [growthData, setGrowthData] = useState<CustomerGrowthData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchChartData = async () => {
      if (!activeTenant) return;
      setLoading(true);
      setError(null);

      /**
       * A versao anterior fazia 24 requisicoes EM SERIE dentro de um `for`
       * (12x DRE + 12x KPIs), levando dezenas de segundos para pintar a tela.
       * Pior: a chamada de KPIs era `?period=month`, sem o mes — identica nas 12
       * voltas do laco. O grafico de crescimento mostrava a mesma medicao doze
       * vezes, desenhando uma linha reta que parecia estagnacao do negocio.
       *
       * Agora os 12 meses vao em paralelo e a serie de crescimento e derivada
       * do proprio DRE mensal, que ja vem com contagem de pedidos e clientes.
       */
      const months = Array.from({ length: 12 }, (_, i) => {
        const date = new Date();
        date.setDate(1); // evita o "pulo de mes" em dia 31
        date.setMonth(date.getMonth() - i);
        return date;
      }).reverse();

      try {
        const results = await Promise.all(
          months.map(async (month) => {
            const monthLabel = month.toLocaleDateString('pt-BR', {
              month: 'short',
              year: '2-digit',
            });
            const dre = await apiGet<DreResponse>('/api/financial/dre', {
              month: month.getMonth() + 1,
              year: month.getFullYear(),
            });
            return { monthLabel, dre };
          })
        );

        if (cancelled) return;

        setMonthlyData(
          results.map(({ monthLabel, dre }) => ({
            month: monthLabel,
            revenue: Math.round(dre.revenue || 0),
            costs: Math.round((dre.cogs || 0) + (dre.expenses || 0)),
            profit: Math.round(dre.netIncome || 0),
          }))
        );
        setGrowthData(
          results.map(({ monthLabel, dre }) => ({
            month: monthLabel,
            customers: dre.activeCustomers || 0,
            sales: dre.orderCount || 0,
          }))
        );
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Erro ao carregar os gráficos.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchChartData();
    return () => {
      cancelled = true;
    };
  }, [activeTenant]);

  if (!activeTenant) {
    return <div className="card p-md">Carregando os dados da loja...</div>;
  }

  if (loading) {
    return <div className="card p-md">Carregando gráficos...</div>;
  }

  if (error) {
    return (
      <div className="card p-md" role="alert">
        <p className="text-danger">{error}</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="Análise de Desempenho"
        subtitle={`${activeTenant.name} - Últimos 12 meses`}
      />

      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--spacing-lg)' }}>
        {/* Gráfico de Barras: Faturamento vs Custos */}
        <Card title="Faturamento vs Custos Mensais" subtitle="Receita bruta comparada com despesas operacionais">
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={monthlyData} margin={{ top: 20, right: 30, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
              <XAxis
                dataKey="month"
                angle={-45}
                textAnchor="end"
                height={80}
                tick={{ fontSize: 12, fill: CHART.axis }}
                stroke={CHART.grid}
              />
              <YAxis
                label={{ value: 'R$', angle: -90, position: 'insideLeft', fill: CHART.axis }}
                tick={{ fontSize: 12, fill: CHART.axis }}
                stroke={CHART.grid}
              />
              <Tooltip
                formatter={(value) =>
                  `R$ ${Number(value ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
                }
                labelFormatter={(label) => `${label}`}
              />
              <Legend />
              <Bar dataKey="revenue" fill={CHART.revenue} name="Receita" radius={[8, 8, 0, 0]} />
              <Bar dataKey="costs" fill={CHART.costs} name="Custos" radius={[8, 8, 0, 0]} />
              <Bar dataKey="profit" fill={CHART.profit} name="Lucro" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Gráfico de Linha: Crescimento de Clientes e Vendas */}
        <Card
          title="Crescimento de Clientes e Vendas"
          subtitle="Evolução mensal de clientes ativos e número de pedidos"
          style={{ marginTop: 'var(--spacing-lg)' }}
        >
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={growthData} margin={{ top: 20, right: 30, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
              <XAxis
                dataKey="month"
                angle={-45}
                textAnchor="end"
                height={80}
                tick={{ fontSize: 12, fill: CHART.axis }}
                stroke={CHART.grid}
              />
              <YAxis
                yAxisId="left"
                label={{ value: 'Clientes', angle: -90, position: 'insideLeft', fill: CHART.axis }}
                tick={{ fontSize: 12, fill: CHART.axis }}
                stroke={CHART.grid}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                label={{ value: 'Vendas', angle: 90, position: 'insideRight', fill: CHART.axis }}
                tick={{ fontSize: 12, fill: CHART.axis }}
                stroke={CHART.grid}
              />
              <Tooltip
                formatter={(value) => String(value)}
                labelFormatter={(label) => `${label}`}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="customers"
                stroke={CHART.revenue}
                name="Clientes Ativos"
                strokeWidth={2}
                dot={{ fill: CHART.revenue, r: 4 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="sales"
                stroke={CHART.profit}
                name="Pedidos"
                strokeWidth={2}
                dot={{ fill: CHART.profit, r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Estatísticas Resumidas */}
        <Card title="Estatísticas Resumidas" style={{ marginTop: 'var(--spacing-lg)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-md)' }}>
            {monthlyData.length > 0 && (
              <>
                <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                  <p style={{ fontSize: '0.875rem', color: 'var(--neutral-600)', margin: 0 }}>Receita Total (12m)</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent)', margin: '8px 0 0 0' }}>
                    R$ {monthlyData.reduce((sum, m) => sum + m.revenue, 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                  </p>
                </div>

                <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                  <p style={{ fontSize: '0.875rem', color: 'var(--neutral-600)', margin: 0 }}>Custos Totais (12m)</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--danger)', margin: '8px 0 0 0' }}>
                    R$ {monthlyData.reduce((sum, m) => sum + m.costs, 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                  </p>
                </div>

                <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                  <p style={{ fontSize: '0.875rem', color: 'var(--neutral-600)', margin: 0 }}>Lucro Total (12m)</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--success)', margin: '8px 0 0 0' }}>
                    R$ {monthlyData.reduce((sum, m) => sum + m.profit, 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                  </p>
                </div>

                <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                  <p style={{ fontSize: '0.875rem', color: 'var(--neutral-600)', margin: 0 }}>Margem Média (12m)</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--accent)', margin: '8px 0 0 0' }}>
                    {monthlyData.length > 0
                      ? ((monthlyData.reduce((sum, m) => sum + m.profit, 0) /
                          monthlyData.reduce((sum, m) => sum + m.revenue, 0)) *
                        100).toFixed(2) + '%'
                      : 'N/A'}
                  </p>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
