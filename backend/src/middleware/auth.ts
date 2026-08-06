/**
 * Autenticacao e autorizacao — fonte unica de verdade.
 *
 * Substitui os dois middlewares que existiam antes (`authMiddleware.ts` e
 * `tenant.ts`), que verificavam o JWT duas vezes na mesma request e gravavam
 * o tenant em campos diferentes do `req`.
 */
import type { Request, Response, NextFunction } from 'express'
import jwt, { type SignOptions } from 'jsonwebtoken'
import { env } from '../config/env.js'
import type { AuthContext } from '../types/express.js'
import { forbidden, unauthorized } from './../lib/http.js'
import { prisma } from '../lib/prisma.js'
import { hasPermission, type Permission } from '../lib/permissions.js'

/** Payload que gravamos dentro do JWT. */
export interface JwtPayload {
  userId: string
  /**
   * Negocio ATIVO desta sessao. Continua no token (mantendo funcionando os
   * pontos que leem `auth.tenantId`), mas agora vem do Membership escolhido —
   * e nao mais de um vinculo fixo no usuario. Alternar de loja reemite o token.
   */
  tenantId: string
  email: string
  /** Papel no negocio ativo: "owner" | "staff". */
  role: string
  /** Vinculo que originou a sessao, usado para revalidar o acesso. */
  membershipId?: string
}

/** Assina um token de acesso para o usuario. */
export function signToken(payload: JwtPayload): string {
  // `expiresIn` aceita string ("7d") ou numero de segundos, mas os tipos do
  // jsonwebtoken usam o literal `StringValue`, que nao aceita `string` puro
  // vindo da configuracao. O cast mantem a validacao no Zod (env.ts).
  const options = { expiresIn: env.JWT_EXPIRES_IN } as SignOptions
  return jwt.sign(payload, env.JWT_SECRET, options)
}

/** Verifica e decodifica um token. Lanca AppError 401 se invalido. */
export function verifyToken(token: string): AuthContext {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload

    // Um token antigo (gerado antes desta correcao) pode nao ter tenantId.
    // Sem tenantId as queries vazariam dados entre lojas, entao recusamos.
    if (!decoded?.userId || !decoded?.tenantId) {
      throw unauthorized('Token sem contexto de loja. Faca login novamente.')
    }

    return {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      email: decoded.email,
      role: decoded.role,
      membershipId: decoded.membershipId,
    }
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthorized('Sessao expirada. Faca login novamente.')
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw unauthorized('Token invalido')
    }
    throw err
  }
}

/** Extrai o token do header Authorization: Bearer <token>. */
function extractToken(req: Request): string | null {
  const header = req.headers.authorization
  if (!header) return null
  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null
  return token.trim()
}

/**
 * Grava o contexto no request.
 *
 * Alem de `req.auth` (forma canonica), preenchemos os campos legados que o
 * codigo antigo espera. Antes desta correcao cada middleware gravava em um
 * lugar diferente: `tenant.ts` gravava `req.tenantId`, `authMiddleware.ts`
 * gravava `req.tenant.id` — e as rotas liam justamente o campo que o
 * middleware ativo NAO preenchia, deixando `tenantId` como `undefined`.
 * Preenchendo todos os formatos, nenhuma rota existente quebra.
 */
function applyContext(req: Request, ctx: AuthContext) {
  req.auth = ctx
  req.tenantId = ctx.tenantId
  req.userId = ctx.userId
  req.tenant = { id: ctx.tenantId }
  req.user = {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    email: ctx.email,
    role: ctx.role,
    permissions: ctx.permissions,
  }
}

/**
 * Exige autenticacao. Preenche `req.auth` com o contexto do usuario.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req)
  if (!token) return next(unauthorized('Token nao fornecido'))

  try {
    const ctx = verifyToken(token)

    // Revalida o vinculo no banco a cada request. Sem isso, o papel e as
    // permissoes ficariam congelados no token: demitir um funcionario ou tirar
    // o acesso ao financeiro so teria efeito quando o token expirasse (7 dias).
    const membership = await prisma.membership.findFirst({
      where: { userId: ctx.userId, tenantId: ctx.tenantId },
      select: {
        id: true,
        role: true,
        permissions: true,
        user: { select: { active: true } },
      },
    })

    if (!membership) {
      return next(unauthorized('Seu acesso a este negocio foi removido. Faca login novamente.'))
    }
    if (!membership.user.active) {
      return next(unauthorized('Conta desativada.'))
    }

    applyContext(req, {
      ...ctx,
      role: membership.role,
      membershipId: membership.id,
      permissions: membership.permissions,
    })
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Autenticacao opcional: preenche `req.auth` se houver token valido,
 * mas nao bloqueia a request. Usado no cardapio publico.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req)
  if (!token) return next()
  try {
    applyContext(req, verifyToken(token))
  } catch {
    // Token ruim em rota opcional e simplesmente ignorado.
  }
  next()
}

/**
 * Exige que o usuario tenha um dos papeis informados.
 *
 * Uso: `router.post('/', requireRole('admin', 'manager'), handler)`
 */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized())
    if (!roles.includes(req.auth.role)) {
      return next(
        forbidden(
          `Esta acao exige um destes perfis: ${roles.join(', ')}. Seu perfil: ${req.auth.role}.`,
        ),
      )
    }
    next()
  }
}

/**
 * Exige uma permissao do catalogo (src/lib/permissions.ts).
 *
 * Owner passa direto. Para funcionario, a chave precisa estar no vinculo.
 * Este e o guard que deve ser usado nas rotas novas — `requireRole` fica
 * apenas para checagens de papel puro (owner vs staff).
 */
export function requirePermission(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized())
    const ok = required.some((p) => hasPermission(req.auth!.role, req.auth!.permissions, p))
    if (!ok) {
      return next(forbidden('Voce nao tem permissao para esta acao. Fale com o dono do negocio.'))
    }
    next()
  }
}

/**
 * Exige ser o dono do negocio.
 *
 * Mantem o nome `requireAdmin` porque varias rotas ja o importam, mas o papel
 * "admin" deixou de existir: quem cria a conta e `owner` no Membership.
 */
export const requireAdmin = requireRole('owner')

/** Acesso a dados financeiros (DRE, KPIs, caixa). */
export const requireFinancialAccess = requirePermission('reports:view')

/** Acesso a gestao de estoque e cadastro de insumos. */
export const requireStockAccess = requirePermission('ingredients:manage')
