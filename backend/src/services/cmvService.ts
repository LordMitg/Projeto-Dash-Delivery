import { prisma } from '../lib/prisma.js'
import { Prisma } from '@prisma/client';


// Estrutura de um item da ficha técnica para cálculo
export interface TechSheetLine {
  ingredientId: string;
  quantity: number;       // Quantidade usada na receita
  isMainProtein?: boolean;
  isPackaging?: boolean;
  notes?: string;
}

// Resultado detalhado do cálculo CMV
export interface CMVResult {
  ingredientCost: number;  // Soma dos insumos com fator de perda
  laborCost: number;       // Mão de obra fixa
  packagingCost: number;   // Custo da embalagem calculado
  totalCostPrice: number;  // CMV final = ingredientCost + laborCost + packagingCost
  margin: number;          // Margem bruta % sobre preço de venda
  lines: CMVLine[];        // Detalhamento linha a linha
}

export interface CMVLine {
  ingredientId: string;
  ingredientName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  breakageFactor: number;
  effectiveQuantity: number; // quantity * (1 + breakageFactor/100)
  lineCost: number;          // effectiveQuantity * unitPrice
  isMainProtein: boolean;
  isPackaging: boolean;
}

export class CMVService {

  /**
   * Calcula o CMV completo de uma ficha técnica em tempo real.
   * Usa os preços atuais dos ingredientes no banco.
   */
  static async calculate(
    tenantId: string,
    lines: TechSheetLine[],
    laborCost: number,
    salePrice: number
  ): Promise<CMVResult> {
    if (!lines.length) {
      return {
        ingredientCost: 0,
        laborCost,
        packagingCost: 0,
        totalCostPrice: laborCost,
        margin: salePrice > 0 ? ((salePrice - laborCost) / salePrice) * 100 : 0,
        lines: [],
      };
    }

    const ingredientIds = lines.map((l) => l.ingredientId);

    // Busca todos os ingredientes da ficha com isolamento de tenant
    const ingredients = await prisma.ingredient.findMany({
      where: {
        id: { in: ingredientIds },
        tenantId,
        active: true,
      },
    });

    const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));

    let ingredientCost = 0;
    let packagingCost = 0;
    const resultLines: CMVLine[] = [];

    for (const line of lines) {
      const ingredient = ingredientMap.get(line.ingredientId);
      if (!ingredient) continue;

      const unitPrice = Number(ingredient.price);
      const breakageFactor = Number(ingredient.breakageFactor); // Ex: 5.00 = 5%
      // Quantidade efetiva: aplica o fator de perda/quebra
      const effectiveQuantity = line.quantity * (1 + breakageFactor / 100);
      const lineCost = effectiveQuantity * unitPrice;

      if (line.isPackaging) {
        packagingCost += lineCost;
      } else {
        ingredientCost += lineCost;
      }

      resultLines.push({
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        unit: ingredient.unit,
        quantity: line.quantity,
        unitPrice,
        breakageFactor,
        effectiveQuantity,
        lineCost,
        isMainProtein: line.isMainProtein ?? false,
        isPackaging: line.isPackaging ?? false,
      });
    }

    const totalCostPrice = ingredientCost + laborCost + packagingCost;
    const margin =
      salePrice > 0 ? ((salePrice - totalCostPrice) / salePrice) * 100 : 0;

    return {
      ingredientCost: roundTo(ingredientCost, 4),
      laborCost: roundTo(laborCost, 4),
      packagingCost: roundTo(packagingCost, 4),
      totalCostPrice: roundTo(totalCostPrice, 4),
      margin: roundTo(margin, 2),
      lines: resultLines,
    };
  }

  /**
   * Regra de Combo:
   * O cliente vê N opções visuais (ex: 3 proteínas), mas a ficha técnica
   * registra apenas 1 proteína principal (isMainProtein = true).
   * Esta função extrai e valida essa proteína do payload recebido.
   */
  static resolveComboProtein(
    lines: TechSheetLine[],
    selectedProteinId: string
  ): TechSheetLine[] {
    const nonProteins = lines.filter((l) => !l.isMainProtein);
    const allProteins = lines.filter((l) => l.isMainProtein);

    // Valida que a proteína selecionada está nas opções do combo
    const selected = allProteins.find((p) => p.ingredientId === selectedProteinId);
    if (!selected) {
      throw new Error(
        `Proteína selecionada (${selectedProteinId}) não está nas opções do combo.`
      );
    }

    // Retorna não-proteínas + apenas a proteína principal selecionada
    return [...nonProteins, { ...selected, isMainProtein: true }];
  }

  /**
   * Calcula e persiste o CMV no campo costPrice do produto.
   * Chamado após salvar/atualizar a ficha técnica.
   */
  static async recalculateAndPersist(
    productId: string,
    tenantId: string
  ): Promise<number> {
    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: {
        technicalSheet: {
          include: { ingredient: true },
        },
      },
    });

    if (!product) throw new Error('Produto não encontrado ou sem acesso.');

    const lines: TechSheetLine[] = product.technicalSheet.map((pi) => ({
      ingredientId: pi.ingredientId,
      quantity: Number(pi.quantity),
      isMainProtein: pi.isMainProtein,
      isPackaging: pi.isPackaging,
    }));

    const cmv = await CMVService.calculate(
      tenantId,
      lines,
      Number(product.laborCost),
      Number(product.price)
    );

    // Persiste o CMV calculado no produto e atualiza custo de cada linha
    await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data: { costPrice: new Prisma.Decimal(cmv.totalCostPrice) },
      }),
      // Atualiza unitCost e totalCost de cada linha da ficha técnica
      ...cmv.lines.map((line) =>
        prisma.productIngredient.updateMany({
          where: { productId, ingredientId: line.ingredientId },
          data: {
            unitCost: new Prisma.Decimal(line.unitPrice),
            totalCost: new Prisma.Decimal(line.lineCost),
          },
        })
      ),
    ]);

    return cmv.totalCostPrice;
  }
}

// Utilitário interno
function roundTo(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
