import { useState } from 'react'
import { LoginPage } from './LoginPage'
import { SignupPage } from './SignupPage'
import { ForgotPasswordPage } from './ForgotPasswordPage'

/**
 * Porta de entrada: escolhe entre entrar, cadastrar e recuperar acesso.
 *
 * Por que estado local e nao rotas: estas tres telas sao pre-sessao e ficam
 * FORA do <Routes> do App, que so existe depois do login. Colocar `/cadastro`
 * e `/recuperar` como rotas obrigaria o roteador a conviver com dois conjuntos
 * de caminhos (autenticado e nao autenticado) — e o `Navigate` de fallback do
 * App engoliria as duas URLs no primeiro render.
 *
 * O e-mail atravessa as telas de proposito: quando o login responde
 * `needsBusiness` (conta valida, sem nenhum negocio), o cadastro abre com o
 * campo ja preenchido e o dono so cria a loja, sem redigitar nada.
 */
type Screen = 'login' | 'signup' | 'forgot'

export function AuthGate() {
  const [screen, setScreen] = useState<Screen>('login')
  const [prefillEmail, setPrefillEmail] = useState('')

  if (screen === 'signup') {
    return (
      <SignupPage
        initialEmail={prefillEmail}
        onBackToLogin={() => {
          setPrefillEmail('')
          setScreen('login')
        }}
      />
    )
  }

  if (screen === 'forgot') {
    return <ForgotPasswordPage onBackToLogin={() => setScreen('login')} />
  }

  return (
    <LoginPage
      onSignup={() => setScreen('signup')}
      onForgot={() => setScreen('forgot')}
      onNeedsBusiness={(email) => {
        setPrefillEmail(email)
        setScreen('signup')
      }}
    />
  )
}
