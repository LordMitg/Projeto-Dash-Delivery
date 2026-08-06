/**
 * Operacao da loja: horario de funcionamento, chave geral e taxa de entrega.
 *
 * A regra central: o PDV so aceita venda se a loja estiver aberta. "Aberta"
 * significa DUAS coisas ao mesmo tempo — a chave geral (`isOpen`) ligada E o
 * horario atual dentro de uma das janelas configuradas para o dia.
 */
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { badRequest, notFound } from '../lib/http.js'

/** Chaves usadas no JSON de horarios. Domingo = 0, para casar com getDay(). */
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** Uma janela de atendimento: das 18:00 as 23:30. */
export const timeWindowSchema = z
  .object({
    from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horario deve estar no formato HH:MM'),
    to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horario deve estar no formato HH:MM'),
  })
  .refine((w) => w.from !== w.to, {
    message: 'O horario de abertura e de fechamento nao podem ser iguais',
  })

export type TimeWindow = z.infer<typeof timeWindowSchema>

/** Horarios da semana. Dia ausente ou lista vazia = fechado naquele dia. */
export const openingHoursSchema = z.object({
  sun: z.array(timeWindowSchema).default([]),
  mon: z.array(timeWindowSchema).default([]),
  tue: z.array(timeWindowSchema).default([]),
  wed: z.array(timeWindowSchema).default([]),
  thu: z.array(timeWindowSchema).default([]),
  fri: z.array(timeWindowSchema).default([]),
  sat: z.array(timeWindowSchema).default([]),
})

export type OpeningHours = z.infer<typeof openingHoursSchema>

/** Taxa de entrega por bairro. */
export const deliveryZoneSchema = z.object({
  name: z.string().trim().min(1, 'Nome do bairro e obrigatorio'),
  fee: z.coerce.number().min(0, 'Taxa nao pode ser negativa'),
  minOrder: z.coerce.number().min(0).default(0),
  etaMinutes: z.coerce.number().int().min(0).default(40),
})

export type DeliveryZone = z.infer<typeof deliveryZoneSchema>

/** Converte "18:30" em 1110 minutos, para comparar horarios sem Date. */
function toMinutes(hhmm: string): number {
  const parts = hhmm.split(':')
  const h = Number(parts[0] ?? 0)
  const m = Number(parts[1] ?? 0)
  return h * 60 + m
}

/**
 * Chave do dia da semana a partir do indice do `Date.getDay()`.
 * Blindado contra indice fora da faixa para satisfazer o modo estrito.
 */
function weekdayKey(dayIndex: number): keyof OpeningHours {
  return WEEKDAYS[((dayIndex % 7) + 7) % 7] as keyof OpeningHours
}

/**
 * Verifica se `nowMinutes` esta dentro da janela.
 *
 * Trata janela que cruza a meia-noite (ex: 19:00 as 02:00): nesse caso
 * `from > to`, e o intervalo valido e "depois do from OU antes do to".
 */
function isWithinWindow(win: TimeWindow, nowMinutes: number): boolean {
  const from = toMinutes(win.from)
  const to = toMinutes(win.to)
  if (from <= to) return nowMinutes >= from && nowMinutes < to
  return nowMinutes >= from || nowMinutes < to
}

export interface StoreStatus {
  /** Resultado final: a loja aceita pedidos agora? */
  open: boolean
  /** Chave geral ligada pelo operador. */
  switchOn: boolean
  /** O horario atual esta dentro de uma janela configurada? */
  withinSchedule: boolean
  /** Mensagem pronta para exibir ao cliente. */
  reason: string
  /** Proximo horario de abertura, quando fechada por horario. */
  nextOpening: string | null
}

/**
 * Calcula o status da loja em um instante.
 *
 * `now` e injetavel para permitir teste deterministico.
 */
export function computeStoreStatus(
  isOpen: boolean,
  openingHours: unknown,
  now: Date = new Date(),
): StoreStatus {
  const parsed = openingHoursSchema.safeParse(openingHours ?? {})
  const hours: OpeningHours = parsed.success
    ? parsed.data
    : openingHoursSchema.parse({})

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const todayWindows = hours[weekdayKey(now.getDay())] ?? []

  // Uma janela iniciada ontem pode ainda estar valendo (ex: 19:00-02:00).
  const yesterdayWindows = hours[weekdayKey(now.getDay() + 6)] ?? []
  const overnightFromYesterday = yesterdayWindows.some((win) => {
    const from = toMinutes(win.from)
    const to = toMinutes(win.to)
    return from > to && nowMinutes < to
  })

  const withinSchedule =
    todayWindows.some((win) => isWithinWindow(win, nowMinutes)) || overnightFromYesterday

  // Se nenhum horario foi configurado, nao travamos a loja pelo horario:
  // a chave geral passa a ser o unico controle.
  const hasAnySchedule = WEEKDAYS.some((day) => (hours[day] ?? []).length > 0)
  const scheduleOk = hasAnySchedule ? withinSchedule : true

  const open = isOpen && scheduleOk

  let reason: string
  if (open) {
    reason = 'Loja aberta'
  } else if (!isOpen) {
    reason = 'Loja fechada pelo operador'
  } else {
    reason = 'Fora do horario de funcionamento'
  }

  return {
    open,
    switchOn: isOpen,
    withinSchedule: scheduleOk,
    reason,
    nextOpening: open ? null : findNextOpening(hours, now),
  }
}

/** Procura o proximo horario de abertura nos proximos 7 dias. */
function findNextOpening(hours: OpeningHours, now: Date): string | null {
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  for (let offset = 0; offset < 8; offset++) {
    const windows = [...(hours[weekdayKey(now.getDay() + offset)] ?? [])].sort(
      (a, b) => toMinutes(a.from) - toMinutes(b.from),
    )

    for (const win of windows) {
      const from = toMinutes(win.from)
      if (offset === 0 && from <= nowMinutes) continue

      const date = new Date(now)
      date.setDate(date.getDate() + offset)
      date.setHours(Math.floor(from / 60), from % 60, 0, 0)
      return date.toISOString()
    }
  }
  return null
}

/** Busca o status atual da loja no banco. */
export async function getStoreStatus(tenantId: string): Promise<StoreStatus> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { isOpen: true, openingHours: true },
  })
  if (!tenant) throw notFound('Loja nao encontrada.')
  return computeStoreStatus(tenant.isOpen, tenant.openingHours)
}

/**
 * Garante que a loja aceita pedidos agora. Lanca 409 se estiver fechada.
 *
 * Chamado antes de criar qualquer pedido — era exatamente a validacao que
 * faltava, permitindo lancar venda com a loja fechada.
 */
export async function assertStoreOpen(tenantId: string): Promise<void> {
  const status = await getStoreStatus(tenantId)
  if (!status.open) {
    throw badRequest(
      `Nao e possivel lancar pedidos: ${status.reason.toLowerCase()}.`,
      'STORE_CLOSED',
    )
  }
}

/**
 * Calcula a taxa de entrega de um bairro.
 *
 * Se o bairro nao estiver cadastrado, usa a taxa base da loja.
 */
export function resolveDeliveryFee(
  zones: unknown,
  baseFee: number,
  neighborhood?: string | null,
): { fee: number; zone: DeliveryZone | null; usedBase: boolean } {
  const parsed = z.array(deliveryZoneSchema).safeParse(zones ?? [])
  const list = parsed.success ? parsed.data : []

  if (!neighborhood) return { fee: baseFee, zone: null, usedBase: true }

  const normalized = neighborhood.trim().toLowerCase()
  const zone = list.find((item) => item.name.trim().toLowerCase() === normalized)

  if (!zone) return { fee: baseFee, zone: null, usedBase: true }
  return { fee: zone.fee, zone, usedBase: false }
}
