import { useEffect, useState } from 'react';
import axios from 'axios';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
  tenantName?: string;
}

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Verificar se há token ao carregar
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');

    if (savedToken) {
      setToken(savedToken);
      setIsAuthenticated(true);

      // Verificar validade do token
      verifyToken(savedToken);
    }

    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (err) {
        localStorage.removeItem('user');
      }
    }

    setLoading(false);
  }, []);

  // Verificar validade do token
  const verifyToken = async (tokenToVerify: string) => {
    try {
      const response = await axios.post(
        '/api/auth/verify',
        {},
        { headers: { Authorization: `Bearer ${tokenToVerify}` } }
      );

      if (response.data.valid) {
        return true;
      } else {
        logout();
        return false;
      }
    } catch (error) {
      logout();
      return false;
    }
  };

  // Fazer login
  const login = async (email: string, password: string, tenantId: string) => {
    try {
      const response = await axios.post('/api/auth/login', {
        email,
        password,
        tenantId
      });

      const { token: newToken, user: userData } = response.data;

      localStorage.setItem('token', newToken);
      localStorage.setItem('user', JSON.stringify(userData));

      setToken(newToken);
      setUser(userData);
      setIsAuthenticated(true);

      // Configurar header padrão de autorização
      axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;

      return true;
    } catch (error) {
      console.error('[v0] Erro ao fazer login:', error);
      return false;
    }
  };

  // Registrar novo usuário
  const register = async (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    tenantId: string
  ) => {
    try {
      const response = await axios.post('/api/auth/register', {
        email,
        password,
        firstName,
        lastName,
        tenantId
      });

      const { token: newToken, user: userData } = response.data;

      localStorage.setItem('token', newToken);
      localStorage.setItem('user', JSON.stringify(userData));

      setToken(newToken);
      setUser(userData);
      setIsAuthenticated(true);

      axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;

      return true;
    } catch (error) {
      console.error('[v0] Erro ao registrar:', error);
      return false;
    }
  };

  // Fazer logout
  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    setToken(null);
    setUser(null);
    setIsAuthenticated(false);

    delete axios.defaults.headers.common['Authorization'];
  };

  // Renovar token
  const refreshToken = async () => {
    if (!token) return false;

    try {
      const response = await axios.post(
        '/api/auth/refresh',
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const newToken = response.data.token;
      localStorage.setItem('token', newToken);
      setToken(newToken);
      axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;

      return true;
    } catch (error) {
      logout();
      return false;
    }
  };

  return {
    user,
    token,
    loading,
    isAuthenticated,
    login,
    register,
    logout,
    refreshToken,
    verifyToken
  };
};
