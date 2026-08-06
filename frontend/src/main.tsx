import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { App } from './pages/App'
import './index.css'

/**
 * A ordem dos provedores importa: o roteador precisa envolver o AuthProvider
 * porque o provedor redireciona para /login quando a sessao expira, e para
 * isso ele precisa do contexto de navegacao.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
