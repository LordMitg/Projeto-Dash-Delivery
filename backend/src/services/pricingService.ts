import { prisma } from '../lib/prisma.js'
import { SalesChannel, Product } from '@prisma/client'


// ---------------------------------------------------------------------------
// TIPOS
// ---------------------------------------------------------------------------

export interface PricingInput {
  costPrice: number   // CMV + mão de obra (já calculado pelo cmvService)
  channel: SalesChannel
}

export interface PricingResult {
  costPrice: number
  markupPerc: number        // % de markup aplicado sobre o custo
  grossPrice: number        // preço antes do arredondamento
  suggestedPrice: number    // arredondado para centavos psicológicos (ex: R$24,90)
  realMarginPerc: number    // margem real após todas as taxas
  breakdown: {
    platformFee: number     // taxa da plataforma em R$
    paymentFee: number      // taxa de pagamento em R$
    totalFees: number
    netRevenue: number      // o que fica no bolso
    profit: number
  }
}

// ---------------------------------------------------------------------------
// FÓRMULA DE MARKUP REVERSO
//
// Premissa: o operador quer uma margem líquida mínima após taxas.
//
// Variáveis:
//   C  = custo total (CMV + mão de obra)
//   Tm = taxa da plataforma (%) — cobrada sobre o preço de venda
//   Tf = taxa fixa por pedido (R$)
//   Tp = taxa de pagamento (%) — cobrada sobre o preço de venda
//   M  = margem desejada (%) — sobre o preço de venda (margem bruta)
//   X  = multiplicador manual
//
// Equação:
//   Preço = C / (1 - Tm/100 - Tp/100 - M/100) + Tf
//   Preço = Preço × X
//
// Prova:
//   Receita Líquida = Preço - (Preço×Tm/100) - Tf - (Preço×Tp/100)
//   Margem = (Receita Líquida - C) / Preço ≥ M/100  ✓
// ---------------------------------------------------------------------------

export function calcMarkupReverse(input: PricingInput): PricingResult {
  const { costPrice, channel } = input

  const Tm = Number(channel.platformFeePerc)   / 100
  const Tf = Number(channel.platformFeeFixed)
  const Tp = Number(channel.paymentFeePerc)    / 100
  const M  = Number(channel.targetMarginPerc)  / 100
  const X  = Number(channel.manualMultiplier)

  // Denominador: o que sobra do preço após todas as taxas percentuais e margem
  const denominator = 1 - Tm - Tp - M

  if (denominator <= 0) {
    throw new Error(
      `Canal "${channel.name}": soma de taxas + margem (${(Tm + Tp + M) * 100}%) ≥ 100%. Revise as configurações.`
    )
  }

  // Preço base antes do multiplicador manual
  const basePrice = (costPrice / denominator) + Tf

  // Aplicar multiplicador manual
  const grossPrice = basePrice * X

  // Arredondamento psicológico: termina em .90 ou .99
  const suggestedPrice = psychologicalRound(grossPrice)

  // Calcular o breakdown real com o preço final
  const platformFee = suggestedPrice * Tm + Tf
  const paymentFee  = suggestedPrice * Tp
  const totalFees   = platformFee + paymentFee
  const netRevenue  = suggestedPrice - totalFees
  const profit      = netRevenue - costPrice
  const realMarginPerc = (profit / suggestedPrice) * 100

  // Markup = quanto o preço está acima do custo em %
  const markupPerc = ((suggestedPrice / costPrice) - 1) * 100

  return {
    costPrice,
    markupPerc: round4(markupPerc),
    grossPrice: round2(grossPrice),
    suggestedPrice,
    realMarginPerc: round4(realMarginPerc),
    breakdown: {
      platformFee: round2(platformFee),
      paymentFee:  round2(paymentFee),
      totalFees:   round2(totalFees),
      netRevenue:  round2(netRevenue),
      profit:      round2(profit),
    },
  }
}

// ---------------------------------------------------------------------------
// CALCULAR E PERSISTIR TABELA DE PREÇOS PARA UM PRODUTO EM TODOS OS CANAIS
// ---------------------------------------------------------------------------

export async function generatePricingTableForProduct(
  productId: string,
  tenantId: string
): Promise<PricingResult[]> {
  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId },
  })

  if (!product) throw new Error('Produto não encontrado')

  const costPrice = Number(product.costPrice) + Number(product.laborCost)

  const channels = await prisma.salesChannel.findMany({
    where: { tenantId, active: true },
  })

  const results: PricingResult[] = []

  await prisma.$transaction(async (tx) => {
    for (const channel of channels) {
      const result = calcMarkupReverse({ costPrice, channel })

      await tx.pricingRule.upsert({
        where: { productId_channelId: { productId, channelId: channel.id } },
        update: {
          costPrice:      result.costPrice,
          markupPerc:     result.markupPerc,
          suggestedPrice: result.suggestedPrice,
          finalPrice:     result.suggestedPrice,
          realMarginPerc: result.realMarginPerc,
          calculatedAt:   new Date(),
        },
        create: {
          productId,
          channelId:      channel.id,
          tenantId,
          costPrice:      result.costPrice,
          markupPerc:     result.markupPerc,
          suggestedPrice: result.suggestedPrice,
          finalPrice:     result.suggestedPrice,
          realMarginPerc: result.realMarginPerc,
        },
      })

      results.push(result)
    }
  })

  return results
}

// ---------------------------------------------------------------------------
// RECALCULAR TODOS OS PRODUTOS DO TENANT (ex: após mudança de canal/taxa)
// ---------------------------------------------------------------------------

export async function recalculateAllPricing(tenantId: string): Promise<number> {
  const products = await prisma.product.findMany({
    where: { tenantId, active: true },
    select: { id: true },
  })

  for (const p of products) {
    await generatePricingTableForProduct(p.id, tenantId)
  }

  return products.length
}

// ---------------------------------------------------------------------------
// UTILITÁRIOS
// ---------------------------------------------------------------------------

function psychologicalRound(price: number): number {
  // Arredonda para cima até o .90 mais próximo
  const floor = Math.floor(price)
  if (price <= floor + 0.90) return parseFloat((floor + 0.90).toFixed(2))
  return parseFloat((floor + 1.90).toFixed(2))
}

function round2(v: number): number { return Math.round(v * 100) / 100 }
function round4(v: number): number { return Math.round(v * 10000) / 10000 }
