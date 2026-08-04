import React from 'react';
import { useTenant } from '../context/TenantContext';

export const Dashboard: React.FC = () => {
  const { activeTenant, loading } = useTenant();

  if (loading) {
    return (
      <div style={{ padding: '20px', color: '#666' }}>
        Carregando...
      </div>
    );
  }

  if (!activeTenant) {
    return (
      <div style={{ padding: '20px', color: '#e74c3c' }}>
        Nenhuma empresa selecionada
      </div>
    );
  }

  return (
    <div style={{ padding: '30px', flex: 1 }}>
      {/* Header */}
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ margin: '0 0 10px 0', fontSize: '32px' }}>Dashboard</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
          Bem-vindo a <strong>{activeTenant.name}</strong>
        </p>
      </div>

      {/* Info da Empresa */}
      <div style={{
        backgroundColor: '#ecf0f1',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '30px',
        border: '1px solid #bdc3c7'
      }}>
        <h3 style={{ margin: '0 0 15px 0', color: '#2c3e50' }}>Informações da Empresa</h3>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '15px',
          fontSize: '14px'
        }}>
          <div>
            <label style={{ opacity: 0.7 }}>Nome:</label>
            <p style={{ margin: '4px 0 0 0', fontWeight: 'bold' }}>{activeTenant.name}</p>
          </div>
          <div>
            <label style={{ opacity: 0.7 }}>Slug:</label>
            <p style={{ margin: '4px 0 0 0', fontWeight: 'bold' }}>{activeTenant.slug}</p>
          </div>
          <div>
            <label style={{ opacity: 0.7 }}>Email:</label>
            <p style={{ margin: '4px 0 0 0', fontWeight: 'bold' }}>{activeTenant.email}</p>
          </div>
          <div>
            <label style={{ opacity: 0.7 }}>Telefone:</label>
            <p style={{ margin: '4px 0 0 0', fontWeight: 'bold' }}>{activeTenant.phone || 'N/A'}</p>
          </div>
        </div>
      </div>

      {/* Cards de Métricas (Placeholder) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '20px',
        marginBottom: '30px'
      }}>
        <MetricCard title="Pedidos Hoje" value="0" icon="📦" />
        <MetricCard title="Entregas" value="0" icon="🚚" />
        <MetricCard title="Clientes" value="0" icon="👥" />
        <MetricCard title="Receita" value="R$ 0,00" icon="💰" />
      </div>

      {/* Seção de Operações */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '20px'
      }}>
        <OperationCard title="Últimos Pedidos" items={[]} />
        <OperationCard title="Entregas Pendentes" items={[]} />
      </div>
    </div>
  );
};

interface MetricCardProps {
  title: string;
  value: string;
  icon: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ title, value, icon }) => (
  <div style={{
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #ecf0f1',
    textAlign: 'center'
  }}>
    <div style={{ fontSize: '28px', marginBottom: '10px' }}>{icon}</div>
    <p style={{ margin: '0 0 10px 0', color: '#666', fontSize: '12px' }}>{title}</p>
    <p style={{ margin: 0, fontSize: '24px', fontWeight: 'bold', color: '#2c3e50' }}>{value}</p>
  </div>
);

interface OperationCardProps {
  title: string;
  items: any[];
}

const OperationCard: React.FC<OperationCardProps> = ({ title, items }) => (
  <div style={{
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #ecf0f1'
  }}>
    <h3 style={{ margin: '0 0 15px 0', color: '#2c3e50' }}>{title}</h3>
    {items.length === 0 ? (
      <p style={{ margin: 0, color: '#95a5a6', fontSize: '14px' }}>Nenhum item a exibir</p>
    ) : (
      <div>
        {items.map((item, idx) => (
          <div key={idx} style={{
            padding: '10px',
            borderBottom: idx < items.length - 1 ? '1px solid #ecf0f1' : 'none'
          }}>
            {JSON.stringify(item)}
          </div>
        ))}
      </div>
    )}
  </div>
);
