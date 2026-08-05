import React, { useState, useEffect } from 'react';
import { TenantProvider } from '../context/TenantContext';
import { Sidebar } from '../components/Sidebar';
import { DashboardKPIs } from '../components/DashboardKPIs';
import { DashboardCharts } from '../components/DashboardCharts';
import { ImpactSimulator } from '../components/ImpactSimulator';
import { PDV } from '../components/PDV';
import { PricingPanel } from '../components/PricingPanel';
import { MainLayout } from '../components/Layout';
import { LoginPage } from './LoginPage';
import { useAuth } from '../hooks/useAuth';

type View = 'charts' | 'dashboard' | 'simulator' | 'pdv' | 'pricing';

export const App: React.FC = () => {
  const { isAuthenticated, loading, user, logout } = useAuth();
  const [currentView, setCurrentView] = useState<View>('charts');

  // Se estiver carregando, mostra spinner
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: '#0f172a',
        color: '#fff'
      }}>
        <div>
          <h2>Carregando Delivery ERP...</h2>
          <p>Verificando autenticação...</p>
        </div>
      </div>
    );
  }

  // Se não autenticado, mostra login
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Função para renderizar view
  const renderView = () => {
    switch (currentView) {
      case 'charts':
        return <DashboardCharts />;
      case 'dashboard':
        return <DashboardKPIs />;
      case 'simulator':
        return <ImpactSimulator />;
      case 'pdv':
        return <PDV />;
      case 'pricing':
        return <PricingPanel />;
      default:
        return <DashboardCharts />;
    }
  };

  return (
    <TenantProvider>
      <MainLayout 
        sidebar={
          <div className="sidebar">
            <div className="sidebar-logo">
              <h2>Delivery ERP</h2>
              <p style={{ fontSize: '12px', color: '#9ca3af', margin: '4px 0' }}>v7.0.0</p>
            </div>

            <div className="sidebar-section">
              <p className="sidebar-label">Menu Principal</p>
              <button 
                className={`btn ${currentView === 'charts' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', marginBottom: '8px' }}
                onClick={() => setCurrentView('charts')}
              >
                📈 Gráficos
              </button>
              <button 
                className={`btn ${currentView === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', marginBottom: '8px' }}
                onClick={() => setCurrentView('dashboard')}
              >
                📊 Dashboard KPIs
              </button>
              <button 
                className={`btn ${currentView === 'pdv' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', marginBottom: '8px' }}
                onClick={() => setCurrentView('pdv')}
              >
                🛒 PDV
              </button>
              <button 
                className={`btn ${currentView === 'pricing' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', marginBottom: '8px' }}
                onClick={() => setCurrentView('pricing')}
              >
                💰 Precificação
              </button>
              <button 
                className={`btn ${currentView === 'simulator' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => setCurrentView('simulator')}
              >
                🎯 Simulador
              </button>
            </div>

            <div className="sidebar-section">
              <p className="sidebar-label">Empresa Ativa</p>
              <Sidebar />
            </div>

            <div className="sidebar-section" style={{ marginTop: 'auto', borderTop: '1px solid #374151', paddingTop: '16px' }}>
              <p className="sidebar-label">Usuário</p>
              <div style={{ fontSize: '12px', color: '#d1d5db', marginBottom: '12px' }}>
                <p style={{ margin: '4px 0' }}>{user?.email}</p>
                <p style={{ margin: '4px 0', color: '#9ca3af' }}>Cargo: {user?.role}</p>
              </div>
              <button 
                className="btn btn-secondary"
                style={{ width: '100%', justifyContent: 'center', textAlign: 'center' }}
                onClick={() => {
                  logout();
                  window.location.reload();
                }}
              >
                Sair
              </button>
            </div>
          </div>
        }
      >
        {renderView()}
      </MainLayout>
    </TenantProvider>
  );
};
