/**
 * Utilitarios de resposta e tratamento de erro.
 *
 * Todo endpoint responde no MESMO formato, para o frontend nunca precisar
 * adivinhar onde estao os dados:
 *
 *   sucesso: { success: true,  data: <payload> }
 *   erro:    { success: false, error: "mensagem legivel", code?: "..." }
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { AuthContext } from '../types/express.js'

// ---------------------------------------------------------------------------
// ERRO DE APLICACAO
// ---------------------------------------------------------------------------

/**
 * Erro com status HTTP embutido. Lance isso em qualquer lugar (rota, service)
 * e o error handler global devolve a resposta correta automaticamente.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const badRequest = (msg: string, code?: string) => new AppError(400, msg, code)
export const unauthorized = (msg = 'Nao autenticado') => new AppError(401, msg, 'UNAUTHENTICATED')
export const forbidden = (msg = 'Acesso negado') => new AppError(403, msg, 'FORBIDDEN')
export const notFound = (msg = 'Recurso nao encontrado') => new AppError(404, msg, 'NOT_FOUND')
export const conflict = (msg: string, code?: string) => new AppError(409, msg, code)

// ---------------------------------------------------------------------------
// RESPOSTAS
// ---------------------------------------------------------------------------

export function ok<T>(res: Response, data: T) {
  return res.status(200).json({ success: true, data: serialize(data) })
}

export function createdResponse<T>(res: Response, data: T) {
  return res.status(201).json({ success: true, data: serialize(data) })
}

/** Alias curto de `createdResponse`, usado nas rotas. */
export const created = createdResponse

/** 204 sem corpo — usado em DELETE. */
export function noContent(res: Response) {
  return res.status(204).send()
}

// ---------------------------------------------------------------------------
// ASYNC HANDLER
// ---------------------------------------------------------------------------

/**
 * Envolve um handler async e encaminha qualquer rejeicao para o `next()`.
 *
 * Sem isso, um `await` que rejeita dentro de uma rota do Express 4 gera
 * "unhandled promise rejection" e o cliente fica esperando pra sempre,
 * porque o Express 4 nao captura promises rejeitadas.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next)
  }
}

// ---------------------------------------------------------------------------
// CONTEXTO DE AUTENTICACAO
// ---------------------------------------------------------------------------

/**
 * Le `req.auth` garantindo que existe.
 *
 * Isso substitui o padrao `(req as any).tenantId`, que silenciosamente
 * retornava undefined e fazia a query buscar em TODOS os tenants.
 */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw unauthorized('Contexto de autenticacao ausente')
  }
  return req.auth
}

/** Atalho para o tenant da requisicao (isolamento multi-loja). */
export function tenantOf(req: Request): string {
  return requireAuth(req).tenantId
}

// ---------------------------------------------------------------------------
// SERIALIZACAO DE DECIMAL
// ---------------------------------------------------------------------------

/**
 * Converte os `Decimal` do Prisma em `number` recursivamente.
 *
 * O Prisma serializa Decimal como objeto ({ s, e, d }) no JSON, o que fazia
 * o frontend exibir "[object Object]" ou NaN ao formatar precos.
 */
export function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, val) => {
      // Decimal do Prisma expoe toFixed; Date nao deve ser tocado.
      if (
        val !== null &&
        typeof val === 'object' &&
        !Array.isArray(val) &&
        typeof (val as { toFixed?: unknown }).toFixed === 'function'
      ) {
        return Number((val as { toFixed: (n: number) => string }).toFixed(4))
      }
      if (typeof val === 'bigint') return Number(val)
      return val
    }),
  ) as T
}

// ---------------------------------------------------------------------------
// HANDLERS GLOBAIS
// ---------------------------------------------------------------------------

/** 404 para rota inexistente. Registrar ANTES do errorHandler. */
export function notFoundHandler(req: Request, res: Response) {
  return res.status(404).json({
    success: false,
    error: `Rota nao encontrada: ${req.method} ${req.originalUrl}`,
    code: 'ROUTE_NOT_FOUND',
  })
}

/** Mapeia codigos de erro do Prisma para respostas legiveis. */
function translatePrismaError(err: {
  code?: string
  meta?: { target?: unknown; field_name?: unknown }
}): AppError | null {
  const target = Array.isArray(err.meta?.target)
    ? (err.meta?.target as string[]).join(', ')
    : String(err.meta?.target ?? '')

  switch (err.code) {
    case 'P2002':
      return conflict(
        target
          ? `Ja existe um registro com este valor de ${target}.`
          : 'Este registro ja existe.',
        'DUPLICATE',
      )
    case 'P2003':
      return badRequest('Registro referenciado nao existe.', 'FK_VIOLATION')
    case 'P2025':
      return notFound('Registro nao encontrado.')
    default:
      return null
  }
}

/**
 * Error handler global. Precisa ter 4 argumentos, senao o Express nao o
 * reconhece como error handler.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  // Erro esperado, lancado pela aplicacao.
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    })
  }

  const anyErr = err as {
    name?: string
    code?: string
    message?: string
    issues?: unknown
    meta?: { target?: unknown; field_name?: unknown }
  }

  // Erro de validacao do Zod que escapou do middleware `validate`.
  if (anyErr?.name === 'ZodError' && Array.isArray(anyErr.issues)) {
    return res.status(400).json({
      success: false,
      error: 'Dados invalidos.',
      code: 'VALIDATION_ERROR',
      issues: anyErr.issues,
    })
  }

  // Erros conhecidos do Prisma.
  if (anyErr?.code?.startsWith('P2')) {
    const translated = translatePrismaError(anyErr)
    if (translated) {
      return res.status(translated.status).json({
        success: false,
        error: translated.message,
        ...(translated.code ? { code: translated.code } : {}),
      })
    }
  }

  // Payload maior que o limite do express.json.
  if (anyErr?.name === 'PayloadTooLargeError') {
    return res.status(413).json({
      success: false,
      error: 'Arquivo ou payload muito grande.',
      code: 'PAYLOAD_TOO_LARGE',
    })
  }

  // Inesperado: loga o stack completo no servidor, mas nao expoe ao cliente.
  console.error('[backend] erro nao tratado:', err)

  return res.status(500).json({
    success: false,
    error: 'Erro interno do servidor. Tente novamente.',
    code: 'INTERNAL_ERROR',
  })
}
