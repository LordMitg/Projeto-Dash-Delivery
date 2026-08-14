import { config as loadDotenv } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const here = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(here, '..', '..')
const repoRoot = path.resolve(backendRoot, '..')

// Carrega o .env do backend e, como fallback, o da raiz do repositorio.
loadDotenv({ path: path.join(backendRoot, '.env') })
loadDotenv({ path: path.join(repoRoot, '.env') })

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL nao definida. Copie backend/.env.example para backend/.env.' })
    .min(1, 'DATABASE_URL nao pode ser vazia.'),

  // Segredo unico do JWT. Sem fallback: um segredo divergente entre modulos
  // era a causa do bug de token valido sendo rejeitado com 401.
  JWT_SECRET: z
    .string({ required_error: 'JWT_SECRET nao definida. Rode: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"' })
    .min(32, 'JWT_SECRET precisa ter no minimo 32 caracteres.'),

  JWT_EXPIRES_IN: z.string().default('12h'),

  PORT: z.coerce.number().int().positive().default(3001),

  // Origens liberadas no CORS. O frontend roda em HTTPS na LAN, entao o IP
  // da maquina tambem precisa ser aceito.
  //
  // Precisa casar com a porta do Vite (`frontend/vite.config.ts`), que e 3000 e
  // usa `strictPort`. O default cobria apenas 5173: o app abria em
  // localhost:3000 e TODA chamada de API morria no CORS — tela montada, vazia,
  // e nenhum erro visivel fora do console do navegador.
  CORS_ORIGINS: z
    .string()
    .default('https://localhost:3000,http://localhost:3000,https://localhost:5173,http://localhost:5173'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(10),

  // Quando true, uma venda e aceita mesmo sem insumo suficiente no estoque
  // (o saldo fica negativo e aparece no relatorio de divergencia).
  // Padrao false: e melhor bloquear a venda do que vender o que nao existe.
  ALLOW_NEGATIVE_STOCK: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  ROUTING_BASE_URL: z.string().url().default('https://router.project-osrm.org'),
  GEOCODING_BASE_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  MAPS_USER_AGENT: z.string().min(3).default('DeliOne/1.0 (delivery routing)'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
    .join('\n')

  console.error(
    [
      '',
      '================================================================',
      ' Configuracao de ambiente invalida. O servidor nao vai subir.',
      '================================================================',
      issues,
      '',
      ' Como resolver:',
      '   1. cd backend && cp .env.example .env',
      '   2. Ajuste DATABASE_URL com o usuario/senha do seu PostgreSQL',
      '   3. Gere um JWT_SECRET e cole no .env',
      '   4. Rode novamente: pnpm dev',
      '================================================================',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

const raw = parsed.data

const corsOrigins = raw.CORS_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const isDevelopment = raw.NODE_ENV === 'development'

/**
 * IPs de rede LOCAL: 192.168.x.x, 10.x.x.x e 172.16-31.x.x.
 *
 * As faixas privadas da RFC 1918 — o endereco que o roteador de casa da ao PC.
 * Note o `172\.(1[6-9]|2\d|3[01])`: a faixa privada do 172 vai so de 16 a 31,
 * e um `172\.\d+` liberaria enderecos publicos.
 */
const PRIVATE_LAN_ORIGIN =
  /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?$/

/**
 * Decide se uma origem pode chamar a API.
 *
 * Existe por causa do scanner no celular: a camera exige HTTPS, o celular acessa
 * pelo IP do PC (`https://192.168.0.10:3000`) e esse IP muda de rede para rede.
 * Antes era preciso descobrir o IP, escrever no `CORS_ORIGINS` e reiniciar o
 * backend — e o sintoma de esquecer era cruel: a tela abria normalmente no
 * celular e TODA chamada morria no CORS, sem erro visivel fora do console.
 *
 * Em desenvolvimento, qualquer IP de LAN privada e aceito. Em producao, apenas a
 * lista explicita, porque ai a origem e um dominio conhecido e liberar faixas
 * inteiras seria uma brecha.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  // Sem `Origin`: mesma origem, curl ou app nativo. O navegador nao omite esse
  // header em requisicao cross-origin, entao isso nao e uma brecha de CORS.
  if (!origin) return true
  if (corsOrigins.includes(origin)) return true
  return isDevelopment && PRIVATE_LAN_ORIGIN.test(origin)
}

/**
 * No formato que o `cors` e o Socket.IO esperam.
 *
 * Nega com `callback(null, false)` em vez de `callback(new Error(...))`: passar um
 * Error faz o middleware lancar, e o error handler devolvia **500** para uma
 * origem barrada. Um 500 diz "o servidor quebrou" quando na verdade a requisicao
 * foi corretamente recusada — o log de producao encheria de falso alarme. Sem o
 * header `Access-Control-Allow-Origin`, o navegador ja bloqueia a chamada, que e
 * exatamente o efeito desejado.
 */
export const corsOriginCheck = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void => {
  callback(null, isOriginAllowed(origin))
}

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment,
  corsOrigins,
} as const

export type Env = typeof env
