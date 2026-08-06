import React from 'react';

// Layout Principal com Sidebar + Main Content
export const MainLayout: React.FC<{ 
  sidebar: React.ReactNode; 
  children: React.ReactNode 
}> = ({ sidebar, children }) => {
  return (
    <div className="app-container">
      {sidebar}
      <div className="main-content">
        {children}
      </div>
    </div>
  );
};

// Header com Título e Ações
export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}> = ({ title, subtitle, actions }) => {
  return (
    <div className="header">
      <div className="header-title">
        <h1>{title}</h1>
        {subtitle && <p style={{ margin: '4px 0 0 0', color: 'var(--neutral-600)' }}>{subtitle}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </div>
  );
};

// Grid de Cards
// `className` e `style` sao repassados porque as telas precisam ajustar o
// espacamento entre secoes sem envolver o grid num <div> extra.
export const CardGrid: React.FC<{
  columns?: 2 | 3 | 4;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ columns = 3, className = '', style, children }) => {
  return (
    <div className={`grid grid-${columns} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
};

// Card Genérico
export const Card: React.FC<{
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ title, subtitle, actions, className = '', style, children }) => {
  return (
    <div className={`card ${className}`.trim()} style={style}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            <h3>{title}</h3>
            {subtitle && <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem' }}>{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="card-body">{children}</div>
    </div>
  );
};

// KPI Card
export const KPICard: React.FC<{
  label: string;
  value: string | number;
  currency?: boolean;
  variation?: number;
  icon?: React.ReactNode;
}> = ({ label, value, currency = false, variation, icon }) => {
  const isPositive = variation !== undefined && variation >= 0;
  
  return (
    <div className="kpi-card">
      {icon && <div style={{ marginBottom: '8px' }}>{icon}</div>}
      <p className="kpi-label">{label}</p>
      <div className="kpi-value">
        {currency && 'R$ '}
        {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
      </div>
      {variation !== undefined && (
        <div className={`kpi-variation ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? '↑' : '↓'} {Math.abs(variation)}% vs período anterior
        </div>
      )}
    </div>
  );
};

// Form Group
export const FormGroup: React.FC<{
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}> = ({ label, required = false, error, children }) => {
  return (
    <div className="form-group">
      <label>
        {label}
        {required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      {children}
      {error && <small style={{ color: 'var(--danger)', marginTop: '4px' }}>{error}</small>}
    </div>
  );
};

// Tabela Simples
export const SimpleTable: React.FC<{
  headers: string[];
  rows: (string | number | React.ReactNode)[][];
  actions?: (rowIndex: number) => React.ReactNode;
}> = ({ headers, rows, actions }) => {
  return (
    <table>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i}>{h}</th>
          ))}
          {actions && <th>Ações</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIdx) => (
          <tr key={rowIdx}>
            {row.map((cell, cellIdx) => (
              <td key={cellIdx}>{cell}</td>
            ))}
            {actions && <td>{actions(rowIdx)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

// Badge
export const Badge: React.FC<{
  variant: 'success' | 'warning' | 'danger' | 'info';
  children: React.ReactNode;
}> = ({ variant, children }) => {
  return <span className={`badge badge-${variant}`}>{children}</span>;
};
