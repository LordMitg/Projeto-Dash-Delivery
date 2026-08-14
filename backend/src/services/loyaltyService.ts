import { Prisma, PrismaClient } from '@prisma/client'
import { badRequest } from '../lib/http.js'

type Db = Prisma.TransactionClient | PrismaClient

export type LoyaltyConfig = {
  couponsEnabled: boolean
  loyaltyPointsEnabled: boolean
  cashbackEnabled: boolean
  pointsPerReal: number
  pointRedemptionValue: number
  cashbackPercent: number
}

export async function getLoyaltyConfig(db: Db, tenantId: string): Promise<LoyaltyConfig> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: {
      couponsEnabled: true,
      loyaltyPointsEnabled: true,
      cashbackEnabled: true,
      pointsPerReal: true,
      pointRedemptionValue: true,
      cashbackPercent: true,
    },
  })
  if (!tenant) throw badRequest('Loja nao encontrada.')
  return {
    couponsEnabled: tenant.couponsEnabled,
    loyaltyPointsEnabled: tenant.loyaltyPointsEnabled,
    cashbackEnabled: tenant.cashbackEnabled,
    pointsPerReal: Number(tenant.pointsPerReal),
    pointRedemptionValue: Number(tenant.pointRedemptionValue),
    cashbackPercent: Number(tenant.cashbackPercent),
  }
}

export async function resolveCoupon(db: Db, params: { tenantId: string; code?: string | null; subtotal: number; customerId?: string | null; config?: LoyaltyConfig }) {
  const code = params.code?.trim().toUpperCase()
  if (!code) return null
  const config = params.config ?? await getLoyaltyConfig(db, params.tenantId)
  if (!config.couponsEnabled) throw badRequest('Esta loja nao participa de cupons.')
  const now = new Date()
  const coupon = await db.coupon.findFirst({ where: { tenantId: params.tenantId, code, active: true } })
  if (!coupon) throw badRequest('Cupom invalido ou inativo.')
  if (coupon.startsAt > now || (coupon.endsAt && coupon.endsAt < now)) throw badRequest('Este cupom esta fora do periodo de validade.')
  if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) throw badRequest('Este cupom atingiu o limite de usos.')
  if (params.subtotal < Number(coupon.minimumOrder)) throw badRequest(`Este cupom exige pedido minimo de R$ ${Number(coupon.minimumOrder).toFixed(2)}.`)
  if (params.customerId && coupon.usageLimitPerCustomer > 0) {
    const used = await db.couponRedemption.count({ where: { couponId: coupon.id, customerId: params.customerId } })
    if (used >= coupon.usageLimitPerCustomer) throw badRequest('Este cliente ja atingiu o limite de uso deste cupom.')
  }
  let amount = coupon.discountType === 'percentage' ? params.subtotal * Number(coupon.discountValue) / 100 : Number(coupon.discountValue)
  if (coupon.maximumDiscount != null) amount = Math.min(amount, Number(coupon.maximumDiscount))
  return { coupon, amount: Math.min(params.subtotal, Math.round(amount * 100) / 100) }
}

export async function quoteBenefits(db: Db, params: { tenantId: string; subtotal: number; customerId?: string | null; couponCode?: string | null; cashbackToUse?: number; pointsToUse?: number }) {
  const config = await getLoyaltyConfig(db, params.tenantId)
  const customer = params.customerId ? await db.customer.findFirst({ where: { id: params.customerId, tenantId: params.tenantId } }) : null
  const cashbackToUse = Number(params.cashbackToUse ?? 0)
  const pointsToUse = Math.floor(Number(params.pointsToUse ?? 0))
  if (cashbackToUse > 0 && !config.cashbackEnabled) throw badRequest('O cashback nao esta ativo nesta loja.')
  if (pointsToUse > 0 && !config.loyaltyPointsEnabled) throw badRequest('O programa de pontos nao esta ativo nesta loja.')
  if ((cashbackToUse > 0 || pointsToUse > 0) && !customer) throw badRequest('Selecione ou identifique o cliente para resgatar beneficios.')
  if (cashbackToUse > Number(customer?.cashbackBalance ?? 0)) throw badRequest('Saldo de cashback insuficiente.')
  if (pointsToUse > Number(customer?.loyaltyPoints ?? 0)) throw badRequest('Saldo de pontos insuficiente.')
  const applied = await resolveCoupon(db, { tenantId: params.tenantId, code: params.couponCode, subtotal: params.subtotal, customerId: customer?.id, config })
  const pointsDiscount = config.loyaltyPointsEnabled ? Math.round(pointsToUse * config.pointRedemptionValue * 100) / 100 : 0
  const discount = Math.min(params.subtotal, (applied?.amount ?? 0) + cashbackToUse + pointsDiscount)
  const eligibleTotal = Math.max(0, params.subtotal - discount)
  return {
    config,
    coupon: applied,
    customer,
    couponCode: applied?.coupon.code ?? null,
    couponDiscount: applied?.amount ?? 0,
    cashbackAvailable: config.cashbackEnabled ? Number(customer?.cashbackBalance ?? 0) : 0,
    cashbackUsed: cashbackToUse,
    pointsAvailable: config.loyaltyPointsEnabled ? Number(customer?.loyaltyPoints ?? 0) : 0,
    pointsUsed: pointsToUse,
    pointsDiscount,
    discount,
    pointsToEarn: config.loyaltyPointsEnabled ? Math.floor(eligibleTotal * config.pointsPerReal) : 0,
    cashbackToEarn: config.cashbackEnabled ? Math.round(eligibleTotal * config.cashbackPercent) / 100 : 0,
  }
}

export async function applyCustomerRewards(db: Db, params: { tenantId: string; customerId: string; orderId: string; total: number; cashbackUsed: number; pointsUsed?: number; actorId?: string | null }) {
  const config = await getLoyaltyConfig(db, params.tenantId)
  const customer = await db.customer.findFirst({ where: { id: params.customerId, tenantId: params.tenantId } })
  if (!customer) throw badRequest('Cliente nao encontrado para aplicar beneficios.')
  const cashbackUsed = config.cashbackEnabled ? params.cashbackUsed : 0
  const pointsUsed = config.loyaltyPointsEnabled ? Math.floor(params.pointsUsed ?? 0) : 0
  if (cashbackUsed > Number(customer.cashbackBalance)) throw badRequest('Saldo de cashback insuficiente.')
  if (pointsUsed > customer.loyaltyPoints) throw badRequest('Saldo de pontos insuficiente.')
  const pointsEarned = config.loyaltyPointsEnabled ? Math.floor(params.total * config.pointsPerReal) : 0
  const cashbackEarned = config.cashbackEnabled ? Math.round(params.total * config.cashbackPercent) / 100 : 0
  const pointsBalance = customer.loyaltyPoints - pointsUsed + pointsEarned
  const cashbackBalance = Math.round((Number(customer.cashbackBalance) - cashbackUsed + cashbackEarned) * 100) / 100
  await db.customer.update({ where: { id: customer.id }, data: { loyaltyPoints: pointsBalance, cashbackBalance: new Prisma.Decimal(cashbackBalance.toFixed(2)) } })
  if (pointsUsed > 0 || cashbackUsed > 0) await db.loyaltyTransaction.create({ data: { pointsDelta: -pointsUsed, cashbackDelta: new Prisma.Decimal((-cashbackUsed).toFixed(2)), pointsBalance: customer.loyaltyPoints - pointsUsed, cashbackBalance: new Prisma.Decimal((Number(customer.cashbackBalance) - cashbackUsed).toFixed(2)), reason: 'Beneficios usados no pedido', sourceType: 'redemption', sourceId: params.orderId, tenantId: params.tenantId, customerId: customer.id, actorId: params.actorId ?? null } })
  if (pointsEarned > 0 || cashbackEarned > 0) await db.loyaltyTransaction.create({ data: { pointsDelta: pointsEarned, cashbackDelta: new Prisma.Decimal(cashbackEarned.toFixed(2)), pointsBalance, cashbackBalance: new Prisma.Decimal(cashbackBalance.toFixed(2)), reason: 'Beneficios gerados pela compra', sourceType: 'order', sourceId: params.orderId, tenantId: params.tenantId, customerId: customer.id, actorId: params.actorId ?? null } })
  return { pointsEarned, cashbackEarned }
}
