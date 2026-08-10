import { useState, type FormEvent } from 'react'
import { ArrowLeft, CheckCircle2, Loader2, ShieldQuestion } from 'lucide-react'
import { apiPost, errorMessage } from '../lib/api'
import {
  AuthShell,
  ErrorBanner,
  Field,
  TextLink,
  fieldClass,
  primaryButtonClass,
} from '../components/AuthShell'

/**
 * Recuperacao de acesso sem e-mail.
 *
 * O sistema roda em loja, muitas vezes num e-mail que o dono nao acessa mais —
 * por isso a recuperacao e por PERGUNTAS, nao por link enviado. O fluxo tem
 * dois passos porque o cliente NAO sabe quais perguntas a conta cadastrou: ele
 * pergunta ao servidor (`/recovery/questions`) e so depois pede as respostas.
 *
 * As duas respostas certas sao obrigatorias, e quem valida e o servidor: aqui
 * nao existe nenhuma comparacao local: os hashes nunca saem do banco.
 */

interface RecoveryQuestion {
  key: string
  label: string
}

type Stage = 'email' | 'answers' | 'done'

export function ForgotPasswordPage({ onBackToLogin }: { onBackToLogin: () => void }) {
  const [stage, setStage] = useState<Stage>('email')

  const [email, setEmail] = useState('')
  const [questions, setQuestions] = useState<RecoveryQuestion[]>([])
  const [answer1, setAnswer1] = useState('')
  const [answer2, setAnswer2] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleFindQuestions(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const data = await apiPost<{ email: string; questions: RecoveryQuestion[] }>(
        '/api/auth/recovery/questions',
        { email: email.trim() },
      )
      // O servidor devolve o e-mail normalizado; usa-lo evita divergencia de
      // maiusculas entre os dois passos.
      setEmail(data.email)
      setQuestions(data.questions)
      setStage('answers')
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível localizar a sua conta.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReset(event: FormEvent) {
    event.preventDefault()
    setError('')

    // Confirmacao checada no cliente: o servidor nao recebe o segundo campo, e
    // errar a senha nova aqui deixaria o dono trancado fora de novo.
    if (newPassword !== confirmPassword) {
      setError('As senhas não conferem.')
      return
    }

    setSubmitting(true)
    try {
      await apiPost('/api/auth/recovery/reset', {
        email,
        answer1: answer1.trim(),
        answer2: answer2.trim(),
        newPassword,
      })
      setStage('done')
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível redefinir a senha.'))
      // Nao limpa as respostas: erro de digitacao e o caso comum, e apagar tudo
      // obrigaria a recomecar sem motivo.
      setNewPassword('')
      setConfirmPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  if (stage === 'done') {
    return (
      <AuthShell
        title="Senha redefinida"
        subtitle="Já pode entrar com a nova senha."
        aside={<RecoveryAside />}
      >
        <div className="mt-8 flex flex-col gap-6">
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-lg border border-good/30 bg-good-soft px-3.5 py-3 text-sm text-good"
          >
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Sua senha foi trocada. Os seus negócios e a sua equipe continuam
              exatamente como estavam.
            </span>
          </div>

          <button type="button" onClick={onBackToLogin} className={primaryButtonClass}>
            Ir para o login
          </button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Recuperar acesso"
      subtitle={
        stage === 'email'
          ? 'Informe o e-mail da conta para carregarmos as suas perguntas.'
          : 'Responda as duas perguntas e escolha a nova senha.'
      }
      aside={<RecoveryAside />}
      footer={
        <>
          Não lembra as respostas? Peça ao dono do negócio para criar um novo acesso
          para você — as respostas não podem ser consultadas por ninguém.
        </>
      }
    >
      {stage === 'email' ? (
        <form onSubmit={handleFindQuestions} className="mt-8 flex flex-col gap-5">
          <ErrorBanner message={error} />

          <Field label="E-mail da conta" htmlFor="recoveryEmail">
            <input
              id="recoveryEmail"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@sualoja.com"
              className={fieldClass}
            />
          </Field>

          <button
            type="submit"
            disabled={submitting}
            className={`mt-1 ${primaryButtonClass}`}
          >
            {submitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            {submitting ? 'Buscando...' : 'Continuar'}
          </button>

          <p className="text-center text-sm text-slate">
            <TextLink onClick={onBackToLogin}>Voltar para o login</TextLink>
          </p>
        </form>
      ) : (
        <form onSubmit={handleReset} className="mt-8 flex flex-col gap-5">
          <ErrorBanner message={error} />

          <p className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-slate">
            <ShieldQuestion aria-hidden="true" className="h-4 w-4 shrink-0 text-brand" />
            <span className="truncate">{email}</span>
          </p>

          <Field
            label={questions[0]?.label ?? 'Pergunta 1'}
            htmlFor="recoveryAnswer1"
            hint="Acentos e maiúsculas não importam."
          >
            <input
              id="recoveryAnswer1"
              required
              value={answer1}
              onChange={(e) => setAnswer1(e.target.value)}
              autoComplete="off"
              className={fieldClass}
            />
          </Field>

          <Field label={questions[1]?.label ?? 'Pergunta 2'} htmlFor="recoveryAnswer2">
            <input
              id="recoveryAnswer2"
              required
              value={answer2}
              onChange={(e) => setAnswer2(e.target.value)}
              autoComplete="off"
              className={fieldClass}
            />
          </Field>

          <Field
            label="Nova senha"
            htmlFor="recoveryPassword"
            hint="No mínimo 6 caracteres."
          >
            <input
              id="recoveryPassword"
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className={fieldClass}
            />
          </Field>

          <Field label="Confirmar nova senha" htmlFor="recoveryPasswordConfirm">
            <input
              id="recoveryPasswordConfirm"
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className={fieldClass}
            />
          </Field>

          <div className="mt-1 flex gap-3">
            <button
              type="button"
              onClick={() => {
                setStage('email')
                setError('')
              }}
              className="flex h-11 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-canvas"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Voltar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`flex-1 ${primaryButtonClass}`}
            >
              {submitting && (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              )}
              {submitting ? 'Redefinindo...' : 'Redefinir senha'}
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  )
}

function RecoveryAside() {
  return (
    <>
      <div className="flex flex-col gap-6">
        <h1 className="max-w-md text-4xl leading-tight font-semibold text-balance lg:text-5xl">
          Sem e-mail, sem suporte, sem ficar de fora do caixa.
        </h1>
        <p className="max-w-md text-base leading-relaxed text-white/70">
          Duas perguntas que só você respondeu no cadastro liberam uma senha nova
          na hora — porque loja parada não espera resposta de e-mail.
        </p>
      </div>

      <dl className="flex flex-col gap-4 border-t border-white/10 pt-8">
        {[
          ['As duas respostas', 'uma só não abre a conta'],
          ['Tentativas limitadas', 'a conta trava depois de erros seguidos'],
          ['Nada é revelado', 'as respostas ficam apenas como hash'],
        ].map(([term, detail]) => (
          <div key={term} className="flex flex-col gap-0.5">
            <dt className="text-sm font-medium text-white">{term}</dt>
            <dd className="text-sm text-white/55">{detail}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}
