import { PrismaClient, Prisma } from '@prisma/client'
import { parseStringPromise } from 'xml2js'

const prisma = new PrismaClient()

// ─── Tipos internos ──────────────────────────────────────────────────────────

export interface ParsedInvoiceItem {
  numeroItem: number
  codigoProduto: string
  descricao: string
  ncm: string
  cfop: string
  unit: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface ParsedInvoice {
  chaveAcesso: string
  numero: string
  serie: string
  emitente: string
  emitenteDoc: string
  emitenteCidade: string
  emitenteUF: string
  destinatarioDoc: string
  dataEmissao: Date
  valorTotal: number
  valorFrete: number
  valorDesconto: number
  valorImposto: number
  items: ParsedInvoiceItem[]
}

export interface ItemMapping {
  codigoProduto: string    // código vindo da NF
  ingredientId: string     // id do Ingredient interno
  dreCategoryId?: string   // categoria DRE para este item
}

// ─── 1. PARSER XML SEFAZ ─────────────────────────────────────────────────────

export async function parseInvoiceXml(xmlContent: string): Promise<ParsedInvoice> {
  const result = await parseStringPromise(xmlContent, {
    explicitArray: false,
    ignoreAttrs: false,
    trim: true,
  })

  // Navega pela estrutura padrão NF-e SEFAZ
  const nfeProc = result.nfeProc || result
  const nfe     = nfeProc.NFe || nfeProc
  const infNFe  = nfe.infNFe

  if (!infNFe) {
    throw new Error('XML inválido: estrutura infNFe não encontrada.')
  }

  const ide   = infNFe.ide
  const emit  = infNFe.emit
  const dest  = infNFe.dest
  const total = infNFe.total?.ICMSTot

  // Chave de acesso: pode vir no atributo Id ou no tag infNFe.$
  const chaveAcesso: string = (
    (infNFe.$ && infNFe.$.Id ? infNFe.$.Id.replace('NFe', '') : '') ||
    (nfeProc.protNFe?.infProt?.chNFe) ||
    ''
  )

  // Normalizar itens (det pode ser array ou objeto único)
  const detRaw  = infNFe.det
  const detList = Array.isArray(detRaw) ? detRaw : [detRaw]

  const items: ParsedInvoiceItem[] = detList.map((det: any) => {
    const prod  = det.prod
    const nItem = parseInt(det.$.nItem || '1', 10)
    return {
      numeroItem:    nItem,
      codigoProduto: String(prod.cProd || ''),
      descricao:     String(prod.xProd || ''),
      ncm:           String(prod.NCM  || ''),
      cfop:          String(prod.CFOP || ''),
      unit:          String(prod.uCom || prod.uTrib || 'UN'),
      quantity:      parseFloat(prod.qCom  || prod.qTrib || '0'),
      unitPrice:     parseFloat(prod.vUnCom || prod.vUnTrib || '0'),
      totalPrice:    parseFloat(prod.vProd || '0'),
    }
  })

  return {
    chaveAcesso,
    numero:         String(ide.nNF || ''),
    serie:          String(ide.serie || '1'),
    emitente:       String(emit.xNome || emit.xFant || ''),
    emitenteDoc:    String(emit.CNPJ || emit.CPF || ''),
    emitenteCidade: String(emit.enderEmit?.xMun || ''),
    emitenteUF:     String(emit.enderEmit?.UF || ''),
    destinatarioDoc:String(dest?.CNPJ || dest?.CPF || ''),
    dataEmissao:    new Date(ide.dhEmi || ide.dEmi),
    valorTotal:     parseFloat(total?.vNF   || '0'),
    valorFrete:     parseFloat(total?.vFrete || '0'),
    valorDesconto:  parseFloat(total?.vDesc || '0'),
    valorImposto:   parseFloat(total?.vTotTrib || total?.vICMS || '0'),
    items,
  }
}

// ─── 2. TRANSAÇÃO PRINCIPAL ──────────────────────────────────────────────────
// Executa em $transaction:
//   a) Persiste Invoice + InvoiceItems
//   b) Para cada item mapeado → atualiza estoque + recalcula preço médio ponderado
//   c) Registra AccountPayable rateado por categoria DRE
//   d) Registra CashEntry (saída) se caixa informado

export async function processInvoice(
  tenantId:      string,
  parsed:        ParsedInvoice,
  mappings:      ItemMapping[],
  cashRegisterId?: string,
  dreCategoryDefaultId?: string,
  dueDate?:      Date,
  xmlRaw?:       string,
) {
  // Impede reprocessamento da mesma chave
  const existing = await prisma.invoice.findUnique({
    where: { chaveAcesso: parsed.chaveAcesso },
  })
  if (existing) {
    throw new Error(`Nota ${parsed.numero} (chave: ${parsed.chaveAcesso}) já foi importada.`)
  }

  const result = await prisma.$transaction(async (tx) => {

    // ── a) Persiste cabeçalho da NF ─────────────────────────────────────────
    const invoice = await tx.invoice.create({
      data: {
        chaveAcesso:     parsed.chaveAcesso,
        numero:          parsed.numero,
        serie:           parsed.serie,
        emitente:        parsed.emitente,
        emitenteDoc:     parsed.emitenteDoc,
        emitenteCidade:  parsed.emitenteCidade,
        emitentUF:       parsed.emitenteUF,
        destinatarioDoc: parsed.destinatarioDoc,
        dataEmissao:     parsed.dataEmissao,
        valorTotal:      new Prisma.Decimal(parsed.valorTotal),
        valorFrete:      new Prisma.Decimal(parsed.valorFrete),
        valorDesconto:   new Prisma.Decimal(parsed.valorDesconto),
        valorImposto:    new Prisma.Decimal(parsed.valorImposto),
        status:          'processed',
        xmlRaw:          xmlRaw || null,
        tenantId,
      },
    })

    // ── b) Itens da NF + atualização de estoque e preço médio ───────────────
    const mappingMap = new Map(mappings.map(m => [m.codigoProduto, m]))
    const stockUpdates: string[] = [] // ingredientIds atualizados

    for (const item of parsed.items) {
      const mapping = mappingMap.get(item.codigoProduto)

      await tx.invoiceItem.create({
        data: {
          invoiceId:     invoice.id,
          numeroItem:    item.numeroItem,
          codigoProduto: item.codigoProduto,
          descricao:     item.descricao,
          ncm:           item.ncm,
          cfop:          item.cfop,
          unit:          item.unit,
          quantity:      new Prisma.Decimal(item.quantity),
          unitPrice:     new Prisma.Decimal(item.unitPrice),
          totalPrice:    new Prisma.Decimal(item.totalPrice),
          ingredientId:  mapping?.ingredientId || null,
        },
      })

      // Só atualiza estoque/custo se houver mapeamento com ingrediente
      if (mapping?.ingredientId) {
        const ingredient = await tx.ingredient.findFirst({
          where: { id: mapping.ingredientId, tenantId },
        })

        if (ingredient) {
          // Preço Médio Ponderado (PMP)
          // PMP = (estoqueAtual × preçoAtual + qtdNova × preçoNF) / (estoqueAtual + qtdNova)
          const estoqueAtual = ingredient.stock
          const precoAtual   = ingredient.price.toNumber()
          const qtdNova      = item.quantity
          const precoNF      = item.unitPrice
          const novoEstoque  = estoqueAtual + qtdNova

          const novoPMP = novoEstoque > 0
            ? (estoqueAtual * precoAtual + qtdNova * precoNF) / novoEstoque
            : precoNF

          await tx.ingredient.update({
            where: { id: ingredient.id },
            data: {
              stock: { increment: Math.floor(qtdNova) }, // stock é Int, arredondamos para unidades inteiras
              price: new Prisma.Decimal(novoPMP.toFixed(4)),
            },
          })

          stockUpdates.push(ingredient.id)
        }
      }
    }

    // ── c) Conta a Pagar rateada ─────────────────────────────────────────────
    const accountPayable = await tx.accountPayable.create({
      data: {
        tenantId,
        description:   `NF ${parsed.numero} - ${parsed.emitente}`,
        supplierName:  parsed.emitente,
        supplierDoc:   parsed.emitenteDoc,
        amount:        new Prisma.Decimal(parsed.valorTotal),
        amountPaid:    new Prisma.Decimal(0),
        dueDate:       dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 dias padrão
        status:        'pending',
        invoiceNumber: parsed.numero,
        invoiceId:     invoice.id,
        dreCategoryId: dreCategoryDefaultId || null,
      },
    })

    // ── d) Lançamento de Caixa (saída) se caixa fornecido ────────────────────
    let cashEntry = null
    if (cashRegisterId) {
      cashEntry = await tx.cashEntry.create({
        data: {
          cashRegisterId,
          type:          'expense',
          amount:        new Prisma.Decimal(parsed.valorTotal),
          description:   `Pagamento NF ${parsed.numero} - ${parsed.emitente}`,
          paymentMethod: 'bank_transfer',
          referenceType: 'invoice',
          referenceId:   invoice.id,
        },
      })
    }

    return { invoice, accountPayable, cashEntry, stockUpdates }
  })

  // ── e) Recalcular CMV dos produtos que usam ingredientes atualizados ───────
  // (fora da transaction pois o cmvService tem sua própria lógica de update)
  if (result.stockUpdates.length > 0) {
    await recalculateCmvForIngredients(tenantId, result.stockUpdates)
  }

  return result
}

// ─── 3. RECALCULAR CMV DOS PRODUTOS AFETADOS ────────────────────────────────

async function recalculateCmvForIngredients(tenantId: string, ingredientIds: string[]) {
  // Encontra todos os produtos do tenant que usam algum dos ingredientes alterados
  const affected = await prisma.productIngredient.findMany({
    where:   { tenantId, ingredientId: { in: ingredientIds } },
    select:  { productId: true },
    distinct: ['productId'],
  })

  for (const row of affected) {
    // Busca ficha técnica completa do produto
    const sheet = await prisma.productIngredient.findMany({
      where:   { productId: row.productId },
      include: { ingredient: true },
    })

    const product = await prisma.product.findUnique({
      where: { id: row.productId },
    })

    if (!product) continue

    let newCostPrice = product.laborCost.toNumber()

    for (const line of sheet) {
      const unitPrice      = line.ingredient.price.toNumber()
      const breakageFactor = line.ingredient.breakageFactor.toNumber()
      const qty            = line.quantity.toNumber()

      const lineCost = qty * unitPrice * (1 + breakageFactor / 100)
      newCostPrice  += lineCost

      // Atualiza o totalCost da linha da ficha técnica
      await prisma.productIngredient.update({
        where: { id: line.id },
        data: {
          unitCost:  new Prisma.Decimal(unitPrice.toFixed(4)),
          totalCost: new Prisma.Decimal(lineCost.toFixed(4)),
        },
      })
    }

    // Persiste novo CMV no produto
    await prisma.product.update({
      where: { id: row.productId },
      data:  { costPrice: new Prisma.Decimal(newCostPrice.toFixed(4)) },
    })
  }
}

// ─── 4. HELPERS ─────────────────────────────────────────────────────────────

// Retorna lista de itens da NF para o frontend montar o mapeamento
export async function getUnmappedItems(tenantId: string, invoiceId: string) {
  return prisma.invoiceItem.findMany({
    where:   { invoiceId, invoice: { tenantId }, ingredientId: null },
    include: { invoice: { select: { numero: true, emitente: true } } },
  })
}
