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
  CORS_ORIGINS: z.string().default('https://localhost:5173,http://localhost:5173'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(10),

  // Quando true, uma venda e aceita mesmo sem insumo suficiente no estoque
  // (o saldo fica negativo e aparece no relatorio de divergencia).
  // Padrao false: e melhor bloquear a venda do que vender o que nao existe.
  ALLOW_NEGATIVE_STOCK: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
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

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
} as const

export type Env = typeof env
