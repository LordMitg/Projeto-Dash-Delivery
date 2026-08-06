import { useState, type FormEvent } from 'react'
import { Loader2, LockKeyhole, Mail } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  AuthShell,
  ErrorBanner,
  Field,
  TextLink,
  fieldWithIconClass,
  primaryButtonClass,
} from '../components/AuthShell'

/**
 * Tela de entrada.
 *
 * Historico: uma versao anterior pedia que o operador escolhesse a "Empresa" num
 * select alimentado por `GET /api/tenants` — rota autenticada. Era circular:
 * precisava estar logado para carregar a lista necessaria para logar. Hoje o
 * e-mail e unico global, resolve a conta direto, e os negocios dela vem NA
 * resposta do login.
 */
export function LoginPage({
  onSignup,
  onForgot,
  onNeedsBusiness,
}: {
  onSignup: () => void
  onForgot: () => void
  /** Conta valida, porem sem nenhum negocio: precisa cadastrar um. */
  onNeedsBusiness: (email: string) => void
}) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const result = await login(email.trim(), password)
      // O dono apagou a ultima loja: sem negocio nao ha token nem dashboard
      // possivel. Levar ao cadastro evita a tela vazia e sem saida.
      if (result.needsBusiness) onNeedsBusiness(email.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel entrar.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title="Entrar"
      subtitle="Use o e-mail e a senha da sua conta."
      footer={
        <>
          Esqueceu a senha? <TextLink onClick={onForgot}>Recuperar acesso</TextLink> com
          as suas perguntas de segurança.
        </>
      }
    >
      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
        <ErrorBanner message={error} />

        <Field label="E-mail" htmlFor="email">
          <div className="relative">
            <Mail
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate"
            />
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@sualoja.com"
              className={fieldWithIconClass}
            />
          </div>
        </Field>

        <Field label="Senha" htmlFor="password">
          <div className="relative">
            <LockKeyhole
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate"
            />
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              className={fieldWithIconClass}
            />
          </div>
        </Field>

        <button type="submit" disabled={submitting} className={`mt-1 ${primaryButtonClass}`}>
          {submitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
          {submitting ? 'Entrando...' : 'Entrar'}
        </button>

        <p className="text-center text-sm text-slate">
          Ainda não tem conta? <TextLink onClick={onSignup}>Cadastre seu negócio</TextLink>
        </p>
      </form>
    </AuthShell>
  )
}
