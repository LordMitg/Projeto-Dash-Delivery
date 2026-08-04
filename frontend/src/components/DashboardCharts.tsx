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
import { PageHeader, Card, CardGrid } from './Layout';
import axios from 'axios';

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

export const DashboardCharts: React.FC = () => {
  const { activeTenant } = useTenant();
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [growthData, setGrowthData] = useState<CustomerGrowthData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchChartData = async () => {
      if (!activeTenant) return;
      try {
        setLoading(true);

        // Buscar dados dos últimos 12 meses
        const token = localStorage.getItem('token');
        const months = Array.from({ length: 12 }, (_, i) => {
          const date = new Date();
          date.setMonth(date.getMonth() - i);
          return date;
        }).reverse();

        // Montar dados de receita vs custos
        const monthlyDataTemp: MonthlyData[] = [];
        const growthDataTemp: CustomerGrowthData[] = [];

        for (const month of months) {
          const monthNum = month.getMonth() + 1;
          const year = month.getFullYear();
          const monthLabel = month.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });

          try {
            // Buscar DRE do mês
            const dreResponse = await axios.get(
              `/api/financial/dre?month=${monthNum}&year=${year}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );

            const dre = dreResponse.data;
            monthlyDataTemp.push({
              month: monthLabel,
              revenue: Math.round(dre.revenue || 0),
              costs: Math.round((dre.cogs || 0) + (dre.expenses || 0)),
              profit: Math.round(dre.netIncome || 0)
            });

            // Buscar KPIs para crescimento
            const kpisResponse = await axios.get(
              `/api/financial/kpis?period=month`,
              { headers: { Authorization: `Bearer ${token}` } }
            );

            const kpis = kpisResponse.data;
            growthDataTemp.push({
              month: monthLabel,
              customers: kpis.activeCustomers || 0,
              sales: kpis.totalOrders || 0
            });
          } catch (err) {
            console.error(`[v0] Erro ao buscar dados do mês ${monthLabel}:`, err);
          }
        }

        setMonthlyData(monthlyDataTemp);
        setGrowthData(growthDataTemp);
      } catch (error) {
        console.error('[v0] Erro ao buscar dados de gráficos:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchChartData();
  }, [activeTenant]);

  if (!activeTenant) {
    return <div className="card" style={{ margin: '20px' }}>Selecione uma empresa</div>;
  }

  if (loading) {
    return <div className="card" style={{ margin: '20px', textAlign: 'center' }}>Carregando gráficos...</div>;
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
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                angle={-45}
                textAnchor="end"
                height={80}
                tick={{ fontSize: 12 }}
              />
              <YAxis label={{ value: 'R$', angle: -90, position: 'insideLeft' }} />
              <Tooltip
                formatter={(value) => `R$ ${value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`}
                labelFormatter={(label) => `${label}`}
              />
              <Legend />
              <Bar dataKey="revenue" fill="#3b82f6" name="Receita" radius={[8, 8, 0, 0]} />
              <Bar dataKey="costs" fill="#ef4444" name="Custos" radius={[8, 8, 0, 0]} />
              <Bar dataKey="profit" fill="#10b981" name="Lucro" radius={[8, 8, 0, 0]} />
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
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                angle={-45}
                textAnchor="end"
                height={80}
                tick={{ fontSize: 12 }}
              />
              <YAxis yAxisId="left" label={{ value: 'Clientes', angle: -90, position: 'insideLeft' }} />
              <YAxis yAxisId="right" orientation="right" label={{ value: 'Vendas', angle: 90, position: 'insideRight' }} />
              <Tooltip
                formatter={(value) => String(value)}
                labelFormatter={(label) => `${label}`}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="customers"
                stroke="#3b82f6"
                name="Clientes Ativos"
                strokeWidth={2}
                dot={{ fill: '#3b82f6', r: 4 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="sales"
                stroke="#10b981"
                name="Pedidos"
                strokeWidth={2}
                dot={{ fill: '#10b981', r: 4 }}
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
