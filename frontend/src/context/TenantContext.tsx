import React, { createContext, useContext, useState, useEffect } from 'react';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  email: string;
  phone?: string;
  active: boolean;
}

interface TenantContextType {
  activeTenant: Tenant | null;
  tenants: Tenant[];
  switchTenant: (tenantId: string) => void;
  loading: boolean;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTenant, setActiveTenant] = useState<Tenant | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  // Carregar tenants do usuário
  useEffect(() => {
    const loadTenants = async () => {
      try {
        // Simular carregamento (será integrado com API)
        const token = localStorage.getItem('token');
        if (!token) {
          setLoading(false);
          return;
        }

        const response = await fetch('http://localhost:3001/api/tenants', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setTenants(data.tenants);
          
          // Restaurar tenant ativo da sessão
          const lastTenantId = localStorage.getItem('activeTenantId');
          const activeT = lastTenantId 
            ? data.tenants.find((t: Tenant) => t.id === lastTenantId)
            : data.tenants[0];
          
          setActiveTenant(activeT);
        }
      } catch (error) {
        console.error('Erro ao carregar tenants:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTenants();
  }, []);

  const switchTenant = (tenantId: string) => {
    const selected = tenants.find(t => t.id === tenantId);
    if (selected) {
      setActiveTenant(selected);
      localStorage.setItem('activeTenantId', tenantId);
    }
  };

  return (
    <TenantContext.Provider value={{ activeTenant, tenants, switchTenant, loading }}>
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant deve ser usado dentro de TenantProvider');
  }
  return context;
};
