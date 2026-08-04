import React, { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import { PageHeader, CardGrid, KPICard, Card } from './Layout';
import axios from 'axios';

interface KPIData {
  revenue: number;
  revenueVariation: number;
  cmvAmount: number;
  cmvPercentage: number;
  grossMargin: number;
  grossMarginVariation: number;
  averageTicket: number;
  averageTicketVariation: number;
  averageLTV: number;
  ltpVariation: number;
  totalOrders: number;
  ordersVariation: number;
  activeCustomers: number;
}

export const DashboardKPIs: React.FC = () => {
  const { activeTenant } = useTenant();
  const [kpis, setKpis] = useState<KPIData | null>(null);
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('month');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchKPIs = async () => {
      if (!activeTenant) return;
      try {
        setLoading(true);
        const response = await axios.get(`/api/financial/kpis?period=${period}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        setKpis(response.data);
      } catch (error) {
        console.error('[v0] Erro ao buscar KPIs:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchKPIs();
  }, [activeTenant, period]);

  if (!activeTenant) {
    return <div className="card" style={{ margin: '20px' }}>Selecione uma empresa</div>;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <PageHeader 
        title="Dashboard Gerencial"
        subtitle={`${activeTenant.name} - Período: ${period.charAt(0).toUpperCase() + period.slice(1)}`}
        actions={
          <select 
            className="sidebar-select" 
            style={{ width: 'auto', minWidth: '150px' }}
            value={period}
            onChange={(e) => setPeriod(e.target.value as any)}
          >
            <option value="today">Hoje</option>
            <option value="week">Esta semana</option>
            <option value="month">Este mês</option>
          </select>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--spacing-lg)' }}>
        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-xl)' }}>
            Carregando dados...
          </div>
        ) : kpis ? (
          <>
            {/* Linha 1: Receita, CMV, Margem */}
            <CardGrid columns={3}>
              <KPICard 
                label="Receita Bruta"
                value={kpis.revenue}
                currency
                variation={kpis.revenueVariation}
                icon="📊"
              />
              <KPICard 
                label="CMV"
                value={kpis.cmvAmount}
                currency
                variation={-kpis.cmvPercentage}
                icon="📦"
              />
              <KPICard 
                label="Margem Bruta"
                value={`${kpis.grossMargin}%`}
                variation={kpis.grossMarginVariation}
                icon="📈"
              />
            </CardGrid>

            {/* Linha 2: Ticket Médio, LTV, Pedidos */}
            <CardGrid columns={3} style={{ marginTop: 'var(--spacing-lg)' }}>
              <KPICard 
                label="Ticket Médio"
                value={kpis.averageTicket}
                currency
                variation={kpis.averageTicketVariation}
                icon="🛒"
              />
              <KPICard 
                label="LTV Médio"
                value={kpis.averageLTV}
                currency
                variation={kpis.ltpVariation}
                icon="👥"
              />
              <KPICard 
                label="Total de Pedidos"
                value={kpis.totalOrders}
                variation={kpis.ordersVariation}
                icon="📋"
              />
            </CardGrid>

            {/* Gráfico de Faturamento */}
            <Card title="Faturamento por Dia" style={{ marginTop: 'var(--spacing-lg)' }}>
              <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--neutral-50)', borderRadius: 'var(--radius-lg)' }}>
                <p style={{ textAlign: 'center', color: 'var(--neutral-400)' }}>
                  Gráfico: Faturamento diário (integrar com Recharts)
                </p>
              </div>
            </Card>

            {/* Gráfico CMV */}
            <Card title="CMV vs Faturamento" style={{ marginTop: 'var(--spacing-lg)' }}>
              <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--neutral-50)', borderRadius: 'var(--radius-lg)' }}>
                <p style={{ textAlign: 'center', color: 'var(--neutral-400)' }}>
                  Gráfico: Comparação CMV vs Receita (integrar com Recharts)
                </p>
              </div>
            </Card>

            {/* Clientes Ativos */}
            <Card title="Resumo de Clientes" style={{ marginTop: 'var(--spacing-lg)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-md)' }}>
                <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--neutral-50)', borderRadius: 'var(--radius-md)' }}>
                  <p className="text-sm" style={{ color: 'var(--neutral-600)', margin: 0 }}>Clientes Ativos</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: '8px 0 0 0' }}>{kpis.activeCustomers}</p>
                </div>
              </div>
            </Card>
          </>
        ) : (
          <div className="card" style={{ padding: 'var(--spacing-xl)', textAlign: 'center' }}>
            Nenhum dado disponível
          </div>
        )}
      </div>
    </div>
  );
};
