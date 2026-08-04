import React, { useState } from 'react';
import { TenantProvider } from '../context/TenantContext';
import { Sidebar } from '../components/Sidebar';
import { DashboardKPIs } from '../components/DashboardKPIs';
import { ImpactSimulator } from '../components/ImpactSimulator';
import { PDV } from '../components/PDV';
import { PricingPanel } from '../components/PricingPanel';
import { MainLayout } from '../components/Layout';

type View = 'dashboard' | 'simulator' | 'pdv' | 'pricing';

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('dashboard');

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <DashboardKPIs />;
      case 'simulator':
        return <ImpactSimulator />;
      case 'pdv':
        return <PDV />;
      case 'pricing':
        return <PricingPanel />;
      default:
        return <DashboardKPIs />;
    }
  };

  return (
    <TenantProvider>
      <MainLayout 
        sidebar={
          <div className="sidebar">
            <div className="sidebar-logo">
              <h2>🚚 Delivery ERP</h2>
            </div>

            <div className="sidebar-section">
              <p className="sidebar-label">Menu Principal</p>
              <button 
                className="btn btn-primary" 
                style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', marginBottom: '8px' }}
                onClick={() => setCurrentView('dashboard')}
              >
                📊 Dashboard
              </button>
              <button 
                className="btn btn-secondary" 
                style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', marginBottom: '8px' }}
                onClick={() => setCurrentView('pdv')}
              >
                🛒 PDV
              </button>
              <button 
                className="btn btn-secondary" 
                style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', marginBottom: '8px' }}
                onClick={() => setCurrentView('pricing')}
              >
                💰 Precificação
              </button>
              <button 
                className="btn btn-secondary" 
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
          </div>
        }
      >
        {renderView()}
      </MainLayout>
    </TenantProvider>
  );
};
