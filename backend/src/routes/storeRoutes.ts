/**
 * Configuracao e operacao da loja.
 *
 * Cobre o requisito 7: chave geral de abrir/fechar, horarios por dia da
 * semana e taxas de entrega por bairro.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, ok, notFound } from '../lib/http.js'
import { validate } from '../lib/validate.js'
import { requireAdmin } from '../middleware/auth.js'
import { emitToTenant } from '../lib/realtime.js'
import {
  getStoreStatus,
  openingHoursSchema,
  deliveryZoneSchema,
} from '../services/storeService.js'

const router = Router()

/**
 * GET /api/store/status
 * Usado pelo PDV a cada carregamento e pelo cardapio publico.
 */
router.get(
  '/status',
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    return ok(res, await getStoreStatus(tenantId))
  }),
)

/** GET /api/store/settings — configuracao completa da loja. */
router.get(
  '/settings',
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        isOpen: true,
        openingHours: true,
        deliveryFeeBase: true,
        deliveryZones: true,
        printSettings: true,
      },
    })

    if (!tenant) throw notFound('Loja nao encontrada.')

    const status = await getStoreStatus(tenantId)
    return ok(res, { ...tenant, status })
  }),
)

/**
 * PATCH /api/store/toggle
 * Chave geral. Emite evento para o PDV e o cardapio reagirem na hora.
 */
router.patch(
  '/toggle',
  validate({ body: z.object({ isOpen: z.coerce.boolean() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const { isOpen } = req.body as { isOpen: boolean }

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { isOpen },
    })

    const status = await getStoreStatus(tenantId)
    emitToTenant(tenantId, 'store:status', status)

    return ok(res, status)
  }),
)

/** PUT /api/store/hours — define os horarios da semana. */
router.put(
  '/hours',
  requireAdmin,
  validate({ body: z.object({ openingHours: openingHoursSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const { openingHours } = req.body as { openingHours: unknown }

    await prisma.tenant.update({
      where: { id: tenantId },
      data: { openingHours: openingHours as object },
    })

    const status = await getStoreStatus(tenantId)
    emitToTenant(tenantId, 'store:status', status)

    return ok(res, { openingHours, status })
  }),
)

/** PUT /api/store/delivery — taxa base e taxas por bairro. */
router.put(
  '/delivery',
  requireAdmin,
  validate({
    body: z.object({
      deliveryFeeBase: z.coerce.number().min(0),
      deliveryZones: z.array(deliveryZoneSchema).default([]),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const { deliveryFeeBase, deliveryZones } = req.body as {
      deliveryFeeBase: number
      deliveryZones: unknown[]
    }

    // Bairro duplicado tornaria a taxa ambigua.
    const names = deliveryZones.map((z) => (z as { name: string }).name.trim().toLowerCase())
    const duplicated = names.find((name, index) => names.indexOf(name) !== index)
    if (duplicated) {
      return res.status(400).json({
        success: false,
        error: `O bairro "${duplicated}" aparece mais de uma vez.`,
      })
    }

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        deliveryFeeBase,
        deliveryZones: deliveryZones as object,
      },
      select: { deliveryFeeBase: true, deliveryZones: true },
    })

    return ok(res, updated)
  }),
)

/** PUT /api/store/profile — dados cadastrais exibidos no cardapio. */
router.put(
  '/profile',
  requireAdmin,
  validate({
    body: z.object({
      name: z.string().trim().min(1).optional(),
      phone: z.string().trim().optional(),
      address: z.string().trim().optional(),
      city: z.string().trim().optional(),
      state: z.string().trim().max(2).optional(),
      zipCode: z.string().trim().optional(),
      printSettings: z.record(z.unknown()).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.auth!
    const body = req.body as Record<string, unknown>

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(body.name !== undefined && { name: body.name as string }),
        ...(body.phone !== undefined && { phone: body.phone as string }),
        ...(body.address !== undefined && { address: body.address as string }),
        ...(body.city !== undefined && { city: body.city as string }),
        ...(body.state !== undefined && { state: (body.state as string).toUpperCase() }),
        ...(body.zipCode !== undefined && { zipCode: body.zipCode as string }),
        ...(body.printSettings !== undefined && { printSettings: body.printSettings as object }),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        printSettings: true,
      },
    })

    return ok(res, updated)
  }),
)

export default router
