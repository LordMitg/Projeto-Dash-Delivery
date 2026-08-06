/**
 * COMPATIBILIDADE — este arquivo virou um alias.
 *
 * A implementacao real de autenticacao vive em `middleware/auth.ts`.
 * Mantemos estes reexports porque varias rotas ainda importam daqui, e
 * duplicar a verificacao de JWT era exatamente o bug anterior: cada arquivo
 * tinha seu proprio `jwt.verify` com um fallback de segredo diferente
 * (`'secret'` vs `'change-me-in-production'`), o que fazia um token valido
 * para um middleware ser invalido para o outro.
 *
 * Em codigo novo, importe de `middleware/auth.js`.
 */
import type { Request } from 'express'
import { authenticate } from './auth.js'
import type { AuthContext } from '../types/express.js'

/** @deprecated use `authenticate` de `middleware/auth.js` */
export const tenantMiddleware = authenticate

/**
 * @deprecated use `authenticate` de `middleware/auth.js`
 *
 * Este nome era importado por `ingredientRoutes.ts`, mas nunca existiu neste
 * arquivo — o import quebrava o boot do servidor inteiro.
 */
export const verifyTenant = authenticate

/**
 * @deprecated use `Request` com `req.auth`
 *
 * Tipo que `invoiceRoutes.ts` importava daqui sem que existisse.
 */
export type AuthRequest = Request & {
  auth?: AuthContext
  tenantId?: string
  userId?: string
}

/** Helper para escopar queries Prisma por tenant. */
export const withTenantContext = (tenantId: string) => ({
  where: { tenantId },
})

export { authenticate }
