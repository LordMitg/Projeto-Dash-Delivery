import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Store, Upload, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiGet } from '../lib/api'
import { toCompactDataUrl } from '../lib/image'
import {
  AuthShell,
  ErrorBanner,
  Field,
  TextLink,
  fieldClass,
  primaryButtonClass,
} from '../components/AuthShell'

/**
 * Cadastro publico: cria a conta do dono E o primeiro negocio, numa transacao
 * unica no servidor.
 *
 * Dividido em dois passos de proposito. Num unico formulario seriam 12 campos
 * de uma vez — o dono desiste. Passo 1 e a conta, passo 2 e o negocio; o que e
 * opcional fica recolhido, porque nada ali bloqueia o uso do sistema.
 */

interface SecurityQuestion {
  key: string
  label: string
}

export function SignupPage({
  onBackToLogin,
  /** Pre-preenche o e-mail quando a conta existe mas nao tem negocio. */
  initialEmail = '',
}: {
  onBackToLogin: () => void
  initialEmail?: string
}) {
  const { signup } = useAuth()
  const [step, setStep] = useState<1 | 2>(1)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')

  const [businessName, setBusinessName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [logoData, setLogoData] = useState('')
  const [showOptional, setShowOptional] = useState(false)

  const [questions, setQuestions] = useState<SecurityQuestion[]>([])
  const [question1, setQuestion1] = useState('')
  const [answer1, setAnswer1] = useState('')
  const [question2, setQuestion2] = useState('')
  const [answer2, setAnswer2] = useState('')

  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // O catalogo vem do servidor para nao divergir do enum que ele valida.
  useEffect(() => {
    let cancelled = false
    apiGet<{ questions: SecurityQuestion[] }>('/api/auth/security-questions')
      .then((data) => {
        if (cancelled) return
        setQuestions(data.questions)
        setQuestion1((prev) => prev || (data.questions[0]?.key ?? ''))
        setQuestion2((prev) => prev || (data.questions[1]?.key ?? ''))
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar as perguntas de segurança.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleLogo(file: File | undefined) {
    if (!file) return
    setError('')
    try {
      setLogoData(await toCompactDataUrl(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível usar esta imagem.')
    }
  }

  function goToStep2(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (password.length < 6) {
      setError('A senha deve ter ao menos 6 caracteres.')
      return
    }
    setStep(2)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')

    if (question1 === question2) {
      setError('Escolha duas perguntas de segurança diferentes.')
      return
    }

    setSubmitting(true)
    try {
      // Só envia o que foi preenchido: strings vazias virariam endereço em
      // branco no cadastro do negócio.
      await signup({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        businessName: businessName.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
        ...(state.trim() ? { state: state.trim() } : {}),
        ...(zipCode.trim() ? { zipCode: zipCode.trim() } : {}),
        ...(logoData ? { logoData } : {}),
        question1,
        answer1: answer1.trim(),
        question2,
        answer2: answer2.trim(),
      })
      // Sem redirecionamento: o AuthProvider passa a ter sessao e o App troca
      // sozinho para a area de trabalho.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a conta.')
      // Volta ao passo 1 quando o problema e do e-mail, que mora lá.
      if (err instanceof Error && /e-mail/i.test(err.message)) setStep(1)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title={step === 1 ? 'Criar conta' : 'Seu negócio'}
      subtitle={
        step === 1
          ? 'Comece pelos seus dados de acesso.'
          : 'Só o nome é obrigatório — o resto você ajusta depois.'
      }
      aside={<SignupAside />}
      footer={
        step === 1 ? (
          <>
            Já tem conta? <TextLink onClick={onBackToLogin}>Entrar</TextLink>
          </>
        ) : (
          <>
            As perguntas de segurança são a única forma de recuperar a senha sem
            e-mail. Escolha respostas que não mudem com o tempo.
          </>
        )
      }
    >
      <ol className="mt-6 flex items-center gap-2" aria-label="Progresso do cadastro">
        {[1, 2].map((n) => (
          <li
            key={n}
            aria-current={step === n ? 'step' : undefined}
            className={`h-1 flex-1 rounded-full ${step >= n ? 'bg-brand' : 'bg-line'}`}
          />
        ))}
      </ol>

      {step === 1 ? (
        <form onSubmit={goToStep2} className="mt-6 flex flex-col gap-5">
          <ErrorBanner message={error} />

          <div className="flex gap-3">
            <Field label="Nome" htmlFor="firstName">
              <input
                id="firstName"
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                placeholder="João"
                className={fieldClass}
              />
            </Field>
            <Field label="Sobrenome" htmlFor="lastName">
              <input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                placeholder="Silva"
                className={fieldClass}
              />
            </Field>
          </div>

          <Field label="E-mail" htmlFor="signupEmail">
            <input
              id="signupEmail"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="voce@sualoja.com"
              className={fieldClass}
            />
          </Field>

          <Field label="Senha" htmlFor="signupPassword" hint="No mínimo 6 caracteres.">
            <input
              id="signupPassword"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Crie uma senha"
              className={fieldClass}
            />
          </Field>

          <button type="submit" className={`mt-1 ${primaryButtonClass}`}>
            Continuar
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-5">
          <ErrorBanner message={error} />

          <Field label="Nome do negócio" htmlFor="businessName">
            <input
              id="businessName"
              required
              minLength={2}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Marmitaria Sabor Caseiro"
              className={fieldClass}
            />
          </Field>

          {/* Logo */}
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface">
              {logoData ? (
                <img src={logoData} alt="Logo escolhido" className="h-full w-full object-cover" />
              ) : (
                <Store aria-hidden="true" className="h-5 w-5 text-slate" />
              )}
            </span>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="logo"
                className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"
              >
                <Upload aria-hidden="true" className="h-4 w-4" />
                {logoData ? 'Trocar logo' : 'Enviar logo'}
              </label>
              <input
                id="logo"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => void handleLogo(e.target.files?.[0])}
              />
              {logoData && (
                <button
                  type="button"
                  onClick={() => setLogoData('')}
                  className="inline-flex w-fit items-center gap-1 text-xs text-slate hover:text-bad"
                >
                  <X aria-hidden="true" className="h-3 w-3" />
                  Remover
                </button>
              )}
            </div>
          </div>

          {/* Opcionais recolhidos: cadastro curto reduz desistencia. */}
          {showOptional ? (
            <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
              <Field label="Telefone" htmlFor="phone">
                <input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(11) 90000-0000"
                  className={fieldClass}
                />
              </Field>
              <Field label="Endereço" htmlFor="address">
                <input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Rua das Flores, 100"
                  className={fieldClass}
                />
              </Field>
              <div className="flex gap-3">
                <Field label="Cidade" htmlFor="city">
                  <input
                    id="city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="São Paulo"
                    className={fieldClass}
                  />
                </Field>
                <Field label="UF" htmlFor="state">
                  <input
                    id="state"
                    maxLength={2}
                    value={state}
                    onChange={(e) => setState(e.target.value.toUpperCase())}
                    placeholder="SP"
                    className={fieldClass}
                  />
                </Field>
              </div>
              <Field label="CEP" htmlFor="zipCode">
                <input
                  id="zipCode"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value)}
                  placeholder="01234-000"
                  className={fieldClass}
                />
              </Field>
            </div>
          ) : (
            <TextLink onClick={() => setShowOptional(true)}>
              + Adicionar endereço e telefone (opcional)
            </TextLink>
          )}

          {/* Perguntas de seguranca */}
          <fieldset className="flex flex-col gap-4 border-t border-line pt-5">
            <legend className="text-sm font-medium text-ink">
              Recuperação de senha
            </legend>

            <Field label="Pergunta 1" htmlFor="question1">
              <select
                id="question1"
                value={question1}
                onChange={(e) => setQuestion1(e.target.value)}
                className={fieldClass}
              >
                {questions.map((q) => (
                  <option key={q.key} value={q.key}>
                    {q.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Resposta 1" htmlFor="answer1">
              <input
                id="answer1"
                required
                minLength={2}
                value={answer1}
                onChange={(e) => setAnswer1(e.target.value)}
                className={fieldClass}
              />
            </Field>

            <Field label="Pergunta 2" htmlFor="question2">
              <select
                id="question2"
                value={question2}
                onChange={(e) => setQuestion2(e.target.value)}
                className={fieldClass}
              >
                {questions.map((q) => (
                  <option key={q.key} value={q.key} disabled={q.key === question1}>
                    {q.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Resposta 2"
              htmlFor="answer2"
              hint="Acentos e maiúsculas não importam na hora de recuperar."
            >
              <input
                id="answer2"
                required
                minLength={2}
                value={answer2}
                onChange={(e) => setAnswer2(e.target.value)}
                className={fieldClass}
              />
            </Field>
          </fieldset>

          <div className="mt-1 flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
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
              {submitting && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
              {submitting ? 'Criando...' : 'Criar negócio'}
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  )
}

function SignupAside() {
  return (
    <>
      <div className="flex flex-col gap-6">
        <h1 className="max-w-md text-4xl leading-tight font-semibold text-balance lg:text-5xl">
          Um cadastro. Quantos negócios você precisar.
        </h1>
        <p className="max-w-md text-base leading-relaxed text-white/70">
          A mesma conta administra a marmitaria e a hamburgueria, com estoque,
          preços e pedidos separados — e um alternador no topo da tela.
        </p>
      </div>

      <dl className="flex flex-col gap-4 border-t border-white/10 pt-8">
        {[
          ['Dados isolados', 'cada negócio com seu próprio estoque e caixa'],
          ['Equipe por loja', 'a mesma pessoa pode ter acessos diferentes'],
          ['Sem e-mail para recuperar', 'duas perguntas de segurança bastam'],
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
