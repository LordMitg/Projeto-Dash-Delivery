import React, { useState } from 'react';
import axios from 'axios';
import { useTenant } from '../context/TenantContext';

interface LoginPageProps {
  onLoginSuccess: (token: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const { tenants } = useTenant();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    tenantId: tenants[0]?.id || '',
    firstName: '',
    lastName: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
      const payload = isLogin
        ? { email: formData.email, password: formData.password, tenantId: formData.tenantId }
        : formData;

      const response = await axios.post(endpoint, payload);
      const { token } = response.data;

      // Armazenar token
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(response.data.user));

      onLoginSuccess(token);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao autenticar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: 'var(--neutral-50)' }}>
      {/* Lado esquerdo: Imagem/Brand */}
      <div
        style={{
          flex: 1,
          background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '60px',
          color: 'white'
        }}
      >
        <h1 style={{ fontSize: '3rem', marginBottom: '20px', textAlign: 'center' }}>🚚 Dash Delivery</h1>
        <p style={{ fontSize: '1.25rem', opacity: 0.9, textAlign: 'center', marginBottom: '40px' }}>
          ERP Multi-Tenant para Delivery
        </p>
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            padding: '30px',
            borderRadius: '12px',
            backdropFilter: 'blur(10px)',
            textAlign: 'center'
          }}
        >
          <p style={{ marginBottom: '10px' }}>✓ Gestão de Insumos</p>
          <p style={{ marginBottom: '10px' }}>✓ PDV com Impressão Térmica</p>
          <p style={{ marginBottom: '10px' }}>✓ Nota Fiscal Automática</p>
          <p>✓ Dashboard com Analytics</p>
        </div>
      </div>

      {/* Lado direito: Formulário */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '60px'
        }}
      >
        <div style={{ width: '100%', maxWidth: '400px' }}>
          <h2 style={{ marginBottom: '30px', color: 'var(--primary)', textAlign: 'center' }}>
            {isLogin ? 'Entrar' : 'Criar Conta'}
          </h2>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
            {error && (
              <div
                style={{
                  padding: 'var(--spacing-md)',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid var(--danger)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--danger)',
                  fontSize: '0.875rem'
                }}
              >
                {error}
              </div>
            )}

            {/* Seletor de Empresa */}
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem', fontWeight: '500' }}>
                Empresa
              </label>
              <select
                name="tenantId"
                value={formData.tenantId}
                onChange={handleChange}
                required
                style={{
                  width: '100%',
                  padding: 'var(--spacing-sm)',
                  border: '1px solid var(--neutral-200)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.875rem'
                }}
              >
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* Email */}
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem', fontWeight: '500' }}>
                Email
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="seu@email.com"
                required
                style={{
                  width: '100%',
                  padding: 'var(--spacing-sm)',
                  border: '1px solid var(--neutral-200)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.875rem'
                }}
              />
            </div>

            {/* Senha */}
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem', fontWeight: '500' }}>
                Senha
              </label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                required
                style={{
                  width: '100%',
                  padding: 'var(--spacing-sm)',
                  border: '1px solid var(--neutral-200)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.875rem'
                }}
              />
            </div>

            {/* Nome (apenas registro) */}
            {!isLogin && (
              <>
                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem', fontWeight: '500' }}>
                    Primeiro Nome
                  </label>
                  <input
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    placeholder="Seu nome"
                    style={{
                      width: '100%',
                      padding: 'var(--spacing-sm)',
                      border: '1px solid var(--neutral-200)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '0.875rem'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.875rem', fontWeight: '500' }}>
                    Sobrenome
                  </label>
                  <input
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    placeholder="Seu sobrenome"
                    style={{
                      width: '100%',
                      padding: 'var(--spacing-sm)',
                      border: '1px solid var(--neutral-200)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '0.875rem'
                    }}
                  />
                </div>
              </>
            )}

            {/* Botão de Submit */}
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary btn-lg"
              style={{ width: '100%', marginTop: 'var(--spacing-md)' }}
            >
              {loading ? 'Aguarde...' : isLogin ? 'Entrar' : 'Criar Conta'}
            </button>

            {/* Toggle entre Login e Register */}
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: 'var(--spacing-sm)' }}
            >
              {isLogin ? 'Não tem conta? Registre-se' : 'Já tem conta? Faça login'}
            </button>
          </form>

          <div style={{ marginTop: '40px', textAlign: 'center', color: 'var(--neutral-600)', fontSize: '0.875rem' }}>
            <p>Demo: Use qualquer email para testar</p>
            <p>Senha mínima: qualquer texto (bcrypt)</p>
          </div>
        </div>
      </div>
    </div>
  );
};
