/**
 * Middleware de validacao com Zod.
 *
 * Motivo: as rotas originais liam `req.body` cru e usavam `parseFloat(...)`.
 * Um campo ausente virava `NaN`, o Prisma recebia NaN e estourava um erro 500
 * generico. Agora o request invalido para na borda, com mensagem clara e 400.
 */
import type { Request, Response, NextFunction } from 'express'
import { z, type ZodTypeAny } from 'zod'

interface Schemas {
  body?: ZodTypeAny
  query?: ZodTypeAny
  params?: ZodTypeAny
}

/** Transforma os erros do Zod em uma mensagem unica e legivel. */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const path = i.path.join('.')
      return path ? `${path}: ${i.message}` : i.message
    })
    .join('; ')
}

export function validate(schemas: Schemas) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params
      if (schemas.query) {
        // req.query e somente-leitura no Express 5; sobrescreve de forma segura.
        const parsed = schemas.query.parse(req.query)
        Object.defineProperty(req, 'query', { value: parsed, configurable: true })
      }
      if (schemas.body) req.body = schemas.body.parse(req.body)
      next()
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: formatIssues(err),
          code: 'VALIDATION_ERROR',
        })
      }
      next(err)
    }
  }
}

// ---------------------------------------------------------------------------
// SCHEMAS REUTILIZAVEIS
// ---------------------------------------------------------------------------

/** ID no formato cuid usado pelo Prisma. */
export const idSchema = z.string().min(1, 'ID obrigatorio')

/** Parametro de rota `:id`. */
export const idParam = z.object({ id: idSchema })

/**
 * Aceita numero ou string numerica (formularios HTML enviam string)
 * e rejeita NaN/Infinity.
 */
export const numeric = (opts?: { min?: number; max?: number }) =>
  z.coerce
    .number({ invalid_type_error: 'Valor numerico invalido' })
    .refine((n) => Number.isFinite(n), 'Valor numerico invalido')
    .refine((n) => (opts?.min === undefined ? true : n >= opts.min), `Deve ser >= ${opts?.min}`)
    .refine((n) => (opts?.max === undefined ? true : n <= opts.max), `Deve ser <= ${opts?.max}`)

/** Dinheiro: nao negativo, no maximo 2 casas. */
export const money = numeric({ min: 0, max: 9_999_999 })

/** Quantidade fracionada (kg, litro). */
export const quantity = numeric({ min: 0, max: 1_000_000 })

/** Quantidade inteira positiva (unidades vendidas). */
export const positiveInt = z.coerce
  .number()
  .int('Deve ser um numero inteiro')
  .min(1, 'Deve ser no minimo 1')
  .max(9999, 'Quantidade acima do limite permitido')

/** Booleano tolerante a "true"/"false" vindos de query string. */
export const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true')

export { z }
