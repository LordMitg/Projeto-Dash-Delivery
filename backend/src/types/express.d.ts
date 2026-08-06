/**
 * Augmentation unica do Request do Express.
 *
 * ANTES existiam duas augmentations concorrentes (middleware/tenant.ts e
 * middleware/authMiddleware.ts), cada uma gravando campos diferentes
 * (`req.tenantId` vs `req.tenant.id`). Dependendo de qual middleware rodava,
 * o outro campo ficava undefined e a query vazava ou falhava.
 *
 * Agora existe UM unico contrato: `req.auth`.
 */

export interface AuthContext {
  userId: string
  tenantId: string
  email: string
  /** Papel NO NEGOCIO ativo: "owner" | "staff". Vem do Membership. */
  role: string
  /** Vinculo conta<->negocio que originou esta sessao. */
  membershipId?: string
  /**
   * Permissoes do vinculo, recarregadas do banco a cada request.
   * Vazio para owner, que tem acesso total implicito.
   */
  permissions?: string[]
}

declare global {
  namespace Express {
    interface Request {
      /**
       * Preenchido pelo middleware `authenticate`.
       * Em rotas protegidas e sempre definido; em rotas publicas e undefined.
       */
      auth?: AuthContext

      // ---- Aliases legados, preenchidos pelo mesmo middleware ----
      // Mantidos para que as rotas escritas antes desta correcao continuem
      // funcionando sem precisar reescrever todas de uma vez.
      /** @deprecated use `req.auth.tenantId` */
      tenantId?: string
      /** @deprecated use `req.auth.userId` */
      userId?: string
      /** @deprecated use `req.auth.tenantId` */
      tenant?: { id: string }
      /** @deprecated use `req.auth` */
      user?: {
        userId: string
        tenantId: string
        email: string
        role: string
        permissions?: string[]
      }
    }
  }
}
