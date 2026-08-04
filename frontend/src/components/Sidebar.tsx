import React from 'react';
import { useTenant } from '../context/TenantContext';

export const Sidebar: React.FC = () => {
  const { activeTenant, tenants, switchTenant } = useTenant();

  return (
    <>
      {/* Empresa Ativa */}
      <div className="sidebar-card">
        <p className="sidebar-label">Empresa Ativa</p>
        <p style={{ margin: '8px 0 4px 0', color: 'white', fontSize: '1rem', fontWeight: 'bold' }}>
          {activeTenant?.name || 'Selecione uma empresa'}
        </p>
        <p style={{ margin: 0, fontSize: '0.75rem', opacity: 0.6 }}>
          {activeTenant?.slug}
        </p>
      </div>

      {/* Seletor de Empresa */}
      <div>
        <p className="sidebar-label">Trocar Empresa</p>
        <select
          className="sidebar-select"
          value={activeTenant?.id || ''}
          onChange={(e) => switchTenant(e.target.value)}
        >
          <option value="">-- Selecione --</option>
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
};

interface MenuLinkProps {
  href: string;
  icon: string;
  label: string;
}

const MenuLink: React.FC<MenuLinkProps> = ({ href, icon, label }) => (
  <a
    href={href}
    style={{
      padding: '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      color: 'white',
      textDecoration: 'none',
      borderRadius: '4px',
      transition: 'background-color 0.2s',
      cursor: 'pointer'
    }}
    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#34495e'}
    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
  >
    <span>{icon}</span>
    <span>{label}</span>
  </a>
);
