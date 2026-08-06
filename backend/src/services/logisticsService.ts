import { Prisma, type Fleet } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

// ---------------------------------------------------------------------------
// TIPOS
// ---------------------------------------------------------------------------

export interface FleetCostBreakdown {
  fuelCost: number        // custo de combustível ida + volta
  driverFee: number       // taxa fixa do motoboy
  extraKmFee: number      // taxa de km excedente ao raio base
  total: number
}

export interface AppDeliveryCost {
  estimatedCost: number   // estimativa de custo do app (taxa % sobre pedido)
  basis: string           // ex: "27% de comissão iFood sobre R$45,00"
}

export interface LogisticsQuoteResult {
  distanceKm: number
  ownFleet: {
    fleetId: string
    fleetName: string
    cost: number
    breakdown: FleetCostBreakdown
  } | null
  appDelivery: AppDeliveryCost
  recommendation: 'own_fleet' | 'app_delivery' | 'no_fleet'
  estimatedSaving: number
  savingLabel: string
}

// ---------------------------------------------------------------------------
// CALCULAR CUSTO DA FROTA PRÓPRIA
//
// Fórmula:
//   distância total = km × 2 (ida e volta)
//   combustível = (distTotal / kmPorLitro) × custoCombustivel
//   km extra = max(0, km - raioBase) × taxaPorKm
//   total = combustível + taxaFixa + km extra
// ---------------------------------------------------------------------------

export function calcOwnFleetCost(
  fleet: Fleet,
  distanceKm: number
): FleetCostBreakdown {
  const kmRound   = distanceKm * 2
  const kmPerL    = Number(fleet.kmPerLiter)
  const fuelCostL = Number(fleet.fuelCostPerLiter)
  const baseRadius = Number(fleet.baseRadiusKm)
  const feePerKm  = Number(fleet.feePerKm)
  const driverFee = Number(fleet.deliveryFee)

  const fuelCost    = (kmRound / kmPerL) * fuelCostL
  const extraKm     = Math.max(0, distanceKm - baseRadius)
  const extraKmFee  = extraKm * feePerKm
  const total       = fuelCost + driverFee + extraKmFee

  return {
    fuelCost:   round2(fuelCost),
    driverFee:  round2(driverFee),
    extraKmFee: round2(extraKmFee),
    total:      round2(total),
  }
}

// ---------------------------------------------------------------------------
// CALCULAR CUSTO ESTIMADO DO APP DE ENTREGA
//
// Usa o canal de venda do pedido para inferir a comissão (taxa da plataforma)
// e estima o custo de entrega como % do valor do pedido.
//
// OBS: apps como iFood cobram comissão sobre o subtotal do pedido, não uma
// taxa fixa de entrega. A "taxa de entrega" que aparece no app é paga pelo
// consumidor — o custo real para o restaurante é a comissão total.
// ---------------------------------------------------------------------------

export function calcAppDeliveryCost(
  orderAmount: number,
  platformFeePerc: number,
  platformFeeFixed: number,
  channelName: string
): AppDeliveryCost {
  const commissionCost = (orderAmount * platformFeePerc / 100) + platformFeeFixed
  return {
    estimatedCost: round2(commissionCost),
    basis: `${platformFeePerc}% de comissão ${channelName} sobre R$${orderAmount.toFixed(2)}${
      platformFeeFixed > 0 ? ` + R$${platformFeeFixed.toFixed(2)} fixo` : ''
    }`,
  }
}

// ---------------------------------------------------------------------------
// GERAR COTAÇÃO COMPLETA E PERSISTIR NA DELIVERY_QUOTE
// ---------------------------------------------------------------------------

export async function generateDeliveryQuote(
  orderId: string,
  tenantId: string,
  distanceKm: number
): Promise<LogisticsQuoteResult> {
  // Buscar pedido com canal de venda
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: { salesChannel: true },
  })

  if (!order) throw new Error('Pedido não encontrado')

  const orderAmount = Number(order.totalAmount) - Number(order.discount)

  // Buscar frota ativa (pega a mais barata disponível)
  const fleets = await prisma.fleet.findMany({
    where: { tenantId, active: true },
  })

  // Calcular custo de cada motoboy e pegar o menor
  let cheapestFleet: { fleet: Fleet; breakdown: FleetCostBreakdown } | null = null

  for (const fleet of fleets) {
    const breakdown = calcOwnFleetCost(fleet, distanceKm)
    if (!cheapestFleet || breakdown.total < cheapestFleet.breakdown.total) {
      cheapestFleet = { fleet, breakdown }
    }
  }

  // Custo do app (usando canal do pedido ou fallback 27% iFood)
  const platformFeePerc  = order.salesChannel ? Number(order.salesChannel.platformFeePerc)  : 27
  const platformFeeFixed = order.salesChannel ? Number(order.salesChannel.platformFeeFixed) : 0
  const channelName      = order.salesChannel?.name ?? 'App Delivery'

  const appCost = calcAppDeliveryCost(orderAmount, platformFeePerc, platformFeeFixed, channelName)

  // Recomendação
  let recommendation: LogisticsQuoteResult['recommendation'] = 'no_fleet'
  let estimatedSaving = 0
  let savingLabel = 'Nenhuma frota cadastrada'

  if (cheapestFleet) {
    const ownCost = cheapestFleet.breakdown.total
    const appC    = appCost.estimatedCost

    if (ownCost <= appC) {
      recommendation = 'own_fleet'
      estimatedSaving = round2(appC - ownCost)
      savingLabel = `Economiza R$${estimatedSaving.toFixed(2)} usando frota própria`
    } else {
      recommendation = 'app_delivery'
      estimatedSaving = round2(ownCost - appC)
      savingLabel = `Economiza R$${estimatedSaving.toFixed(2)} usando app de entrega`
    }
  }

  // Persistir cotação
  await prisma.deliveryQuote.upsert({
    where: { orderId },
    create: {
      orderId,
      tenantId,
      distanceKm,
      ownFleetCost:      cheapestFleet ? cheapestFleet.breakdown.total : 0,
      ownFleetBreakdown: (cheapestFleet ? { ...cheapestFleet.breakdown } : {}) as Prisma.InputJsonObject,
      appDeliveryCost:   appCost.estimatedCost,
      recommendation,
      estimatedSaving,
      fleetId:           cheapestFleet?.fleet.id ?? null,
    },
    update: {
      distanceKm,
      ownFleetCost:      cheapestFleet ? cheapestFleet.breakdown.total : 0,
      ownFleetBreakdown: (cheapestFleet ? { ...cheapestFleet.breakdown } : {}) as Prisma.InputJsonObject,
      appDeliveryCost:   appCost.estimatedCost,
      recommendation,
      estimatedSaving,
      fleetId:           cheapestFleet?.fleet.id ?? null,
    },
  })

  return {
    distanceKm,
    ownFleet: cheapestFleet
      ? {
          fleetId:   cheapestFleet.fleet.id,
          fleetName: cheapestFleet.fleet.name,
          cost:      cheapestFleet.breakdown.total,
          breakdown: cheapestFleet.breakdown,
        }
      : null,
    appDelivery: appCost,
    recommendation,
    estimatedSaving,
    savingLabel,
  }
}

// ---------------------------------------------------------------------------
// CONFIRMAR DECISÃO DO OPERADOR
// ---------------------------------------------------------------------------

export async function confirmDeliveryChoice(
  orderId: string,
  tenantId: string,
  choice: 'own_fleet' | 'app_delivery'
): Promise<void> {
  await prisma.deliveryQuote.updateMany({
    where: { orderId, tenantId },
    data: { chosenOption: choice, decidedAt: new Date() },
  })
}

// ---------------------------------------------------------------------------
// UTILITÁRIOS
// ---------------------------------------------------------------------------

function round2(v: number): number { return Math.round(v * 100) / 100 }
