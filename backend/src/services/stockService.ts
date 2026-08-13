/**
 * Baixa de estoque na venda.
 *
 * LACUNA CORRIGIDA: o sistema calculava o CMV corretamente, mas NUNCA
 * descontava insumo nenhum ao vender. O estoque ficava congelado para sempre,
 * e o alerta de "estoque baixo" nunca disparava.
 *
 * Regras implementadas aqui:
 *  - A quantidade baixada usa o fator de quebra do insumo. Se a receita pede
 *    180 g de frango e a quebra e 8%, o estoque perde 194,4 g — que e o que
 *    realmente sai da camara.
 *  - No combo, desconta APENAS a proteina escolhida na venda, nunca as tres.
 *  - Adicionais (bacon extra, refrigerante) tambem descontam seu insumo.
 *  - Tudo roda dentro da transacao do pedido: se faltar um unico insumo,
 *    o pedido inteiro e desfeito e nada e cobrado.
 */
import { Prisma } from '@prisma/client'
import { conflict } from '../lib/http.js'

/** Cliente de transacao do Prisma. */
type Tx = Prisma.TransactionClient

/** Uma linha de consumo a ser descontada do estoque. */
export interface StockConsumption {
  ingredientId: string
  /** Quantidade da receita, ANTES do fator de quebra. */
  quantity: number
}

/**
 * Agrupa consumos repetidos do mesmo insumo.
 *
 * Necessario porque um pedido pode ter 3 marmitas de frango: sem agrupar,
 * fariamos 3 updates concorrentes na mesma linha e o ultimo sobrescreveria
 * os anteriores (lost update).
 */
export function mergeConsumptions(list: StockConsumption[]): Map<string, number> {
  const merged = new Map<string, number>()
  for (const item of list) {
    if (!item.ingredientId || item.quantity <= 0) continue
    merged.set(item.ingredientId, (merged.get(item.ingredientId) ?? 0) + item.quantity)
  }
  return merged
}

/**
 * Aplica a baixa de estoque dentro de uma transacao.
 *
 * @param allowNegative Permite vender com estoque negativo. Util para lojas
 *        que ainda nao cadastraram o estoque inicial e nao querem ser
 *        bloqueadas. Configuravel por ambiente.
 */
export async function applyStockDeduction(
  tx: Tx,
  tenantId: string,
  consumptions: StockConsumption[],
  allowNegative = false,
  actorId?: string,
): Promise<Array<{ ingredientId: string; name: string; deducted: number; remaining: number }>> {
  const merged = mergeConsumptions(consumptions)
  if (merged.size === 0) return []

  const ingredients = await tx.ingredient.findMany({
    where: { id: { in: [...merged.keys()], }, tenantId },
  })

  const byId = new Map(ingredients.map((i) => [i.id, i]))
  const report: Array<{ ingredientId: string; name: string; deducted: number; remaining: number }> = []

  for (const [ingredientId, rawQty] of merged) {
    const ing = byId.get(ingredientId)

    // Insumo de outra loja ou inexistente: aborta em vez de ignorar,
    // senao o pedido sairia sem baixar nada e o estoque mentiria.
    if (!ing) {
      throw conflict(`Insumo ${ingredientId} nao pertence a esta loja ou foi removido`)
    }

    // Quebra: 8% de perda => consome 8% a mais do estoque.
    const breakage = Number(ing.breakageFactor) / 100
    const effectiveQty = rawQty * (1 + breakage)
    const remaining = Number(ing.stock) - effectiveQty

    if (remaining < 0 && !allowNegative) {
      throw conflict(
        `Estoque insuficiente de "${ing.name}": ` +
          `necessario ${effectiveQty.toFixed(3)} ${ing.unit}, ` +
          `disponivel ${Number(ing.stock).toFixed(3)} ${ing.unit}.`,
      )
    }

    await tx.ingredient.update({
      where: { id: ing.id },
      data: { stock: new Prisma.Decimal(remaining.toFixed(4)) },
    })

    await tx.stockMovement.create({
      data: {
        type: 'sale',
        delta: new Prisma.Decimal((-effectiveQty).toFixed(4)),
        balanceBefore: ing.stock,
        balanceAfter: new Prisma.Decimal(remaining.toFixed(4)),
        reason: 'Baixa automatica por venda',
        sourceType: 'order',
        tenantId,
        ingredientId: ing.id,
        actorId: actorId ?? null,
      },
    })

    report.push({
      ingredientId: ing.id,
      name: ing.name,
      deducted: Number(effectiveQty.toFixed(4)),
      remaining: Number(remaining.toFixed(4)),
    })
  }

  return report
}

/**
 * Devolve o estoque ao cancelar um pedido.
 * Espelha exatamente o calculo da baixa, incluindo o fator de quebra.
 */
export async function restoreStock(
  tx: Tx,
  tenantId: string,
  consumptions: StockConsumption[],
  actorId?: string,
  sourceId?: string,
): Promise<void> {
  const merged = mergeConsumptions(consumptions)
  if (merged.size === 0) return

  const ingredients = await tx.ingredient.findMany({
    where: { id: { in: [...merged.keys()] }, tenantId },
  })

  for (const ing of ingredients) {
    const rawQty = merged.get(ing.id)
    if (rawQty === undefined) continue
    const breakage = Number(ing.breakageFactor) / 100
    const effectiveQty = rawQty * (1 + breakage)
    await tx.ingredient.update({
      where: { id: ing.id },
      data: { stock: new Prisma.Decimal((Number(ing.stock) + effectiveQty).toFixed(4)) },
    })
    await tx.stockMovement.create({
      data: {
        type: 'return',
        delta: new Prisma.Decimal(effectiveQty.toFixed(4)),
        balanceBefore: ing.stock,
        balanceAfter: new Prisma.Decimal((Number(ing.stock) + effectiveQty).toFixed(4)),
        reason: 'Estoque devolvido pelo cancelamento do pedido',
        sourceType: 'order',
        sourceId: sourceId ?? null,
        tenantId,
        ingredientId: ing.id,
        actorId: actorId ?? null,
      },
    })
  }
}
