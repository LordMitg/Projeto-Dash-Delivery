/**
 * COMPATIBILIDADE — este arquivo virou um alias.
 *
 * A implementacao real vive em `middleware/auth.ts`. Antes, este arquivo
 * gravava o tenant em `req.tenant.id` enquanto `tenant.ts` gravava em
 * `req.tenantId`, e as rotas liam justamente o campo errado.
 *
 * Em codigo novo, importe de `middleware/auth.js`.
 */
export {
  authenticate,
  authenticate as default,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireFinancialAccess,
  requireStockAccess,
  signToken,
  verifyToken,
} from './auth.js'

export type { JwtPayload } from './auth.js'
