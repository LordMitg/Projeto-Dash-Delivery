/**
 * Rotas do scanner de camera.
 *
 * Tres operacoes, todas desenhadas em volta de uma regra: NADA entra no
 * estoque sem o usuario confirmar na tela.
 *
 *   GET  /api/scanner/lookup       — le um codigo de barras e diz o que e
 *   POST /api/scanner/nfce         — le o QR da nota e devolve os itens
 *   POST /api/scanner/stock-entry  — grava a entrada JA CONFERIDA
 *
 * As duas primeiras sao somente leitura: consultam e sugerem, sem gravar nada.
 * So a terceira escreve, e ela recebe exatamente o que o usuario viu e ajustou
 * na tela de conferencia — nunca o que o portal da SEFAZ mandou. Essa
 * separacao e o que permite corrigir "3 leites" para "4 leites" antes de
 * qualquer coisa tocar o banco.
 */
import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import {
  asyncHandler,
  ok,
  created,
  badRequest,
  conflict,
  tenantOf,
  serialize,
} from '../lib/http.js'
import { requireStockAccess } from '../middleware/auth.js'
import { validate, z } from '../lib/validate.js'
import { lookupNfce, UF_LIST } from '../services/nfceService.js'

const router = Router()

/** Decimal com 4 casas — a mesma precisao das colunas de estoque. */
const dec4 = (v: number) => new Prisma.Decimal(v.toFixed(4))
/** Decimal com 2 casas — colunas de dinheiro. */
const dec2 = (v: number) => new Prisma.Decimal(v.toFixed(2))

// ---------------------------------------------------------------------------
// NORMALIZACAO DE TEXTO PARA COMPARACAO
// ---------------------------------------------------------------------------

/**
 * Reduz um nome de produto a uma forma comparavel.
 *
 * A descricao na nota ("LEITE COND MOCA 395G") quase nunca bate letra a letra
 * com o cadastro interno ("Leite Condensado Moça"). Tirar acento, pontuacao e
 * caixa e o minimo para as duas terem chance de se encontrar.
 */
function normalize(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Palavras curtas e unidades nao ajudam a identificar o produto. */
const STOPWORDS = new Set([
  'de', 'da', 'do', 'com', 'sem', 'para', 'kg', 'g', 'ml', 'l', 'un', 'und',
  'pct', 'cx', 'lt', 'pc', 'em', 'tipo', 'the', 'and',
])

function tokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

/**
 * Similaridade de 0 a 1 entre duas descricoes, por sobreposicao de palavras
 * (indice de Jaccard).
 *
 * Escolhi Jaccard em vez de distancia de edicao porque o problema real aqui e
 * ordem e ruido de palavras ("ACUCAR UNIAO REFINADO 1KG" x "Açúcar refinado
 * União"), nao erro de digitacao. Distancia de edicao pontuaria mal justamente
 * os casos que mais importam.
 */
function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a))
  const tb = new Set(tokens(b))
  if (ta.size === 0 || tb.size === 0) return 0

  let intersection = 0
  for (const t of ta) if (tb.has(t)) intersection++

  const union = ta.size + tb.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** Abaixo disso a sugestao atrapalha mais do que ajuda. */
const SIMILARITY_THRESHOLD = 0.34

// ---------------------------------------------------------------------------
// GET /api/scanner/lookup?code=EAN
// ---------------------------------------------------------------------------

/**
 * Resolve um codigo de barras nos DOIS cadastros de uma vez.
 *
 * Neste sistema o estoque mora no insumo (kg, l, un) e o produto de venda so
 * consome insumo pela ficha tecnica. Quem escaneia uma embalagem no deposito
 * quer o insumo; quem escaneia no balcao pode querer o produto. Consultar os
 * dois numa chamada evita a tela ter que adivinhar — e evita o vaivem de duas
 * requisicoes por bipe, que no celular pesa.
 */
router.get(
  '/lookup',
  validate({ query: z.object({ code: z.string().trim().min(3).max(64) }) }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const code = String((req.query as { code: string }).code)

    const [ingredient, product] = await Promise.all([
      prisma.ingredient.findFirst({
        where: { tenantId, barcode: code },
        select: {
          id: true, name: true, unit: true, stock: true, minimumStock: true,
          price: true, sku: true, barcode: true, active: true,
        },
      }),
      prisma.product.findFirst({
        where: { tenantId, barcode: code },
        select: { id: true, name: true, price: true, sku: true, barcode: true, active: true },
      }),
    ])

    return ok(res, {
      code,
      ingredient,
      product,
      found: Boolean(ingredient || product),
    })
  }),
)

// ---------------------------------------------------------------------------
// POST /api/scanner/nfce
// ---------------------------------------------------------------------------

const nfceSchema = z.object({
  /** Conteudo bruto do QR Code, ou a chave de 44 digitos digitada. */
  qr: z.string().trim().min(10).max(2048),
  /** Sobrescreve a UF derivada da chave. So para casos excepcionais. */
  uf: z.enum(UF_LIST as [string, ...string[]]).optional(),
})

/**
 * Le o QR da nota, consulta a SEFAZ e ja sugere o vinculo de cada item com o
 * estoque existente.
 *
 * Nao grava nada. O `match` de cada item e apenas uma SUGESTAO, e vem com o
 * motivo (`barcode` ou `nome`) para o usuario julgar se confia. Casar por
 * codigo de barras e praticamente certo; casar por nome e um palpite, e a tela
 * mostra os dois de forma diferente por isso.
 */
router.post(
  '/nfce',
  validate({ body: nfceSchema }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const { qr, uf } = req.body as z.infer<typeof nfceSchema>

    let result
    try {
      result = await lookupNfce(qr, uf)
    } catch (err) {
      // `lookupNfce` so lanca para entrada invalida (chave ilegivel ou DV
      // errado), que e culpa do dado e nao do portal — por isso 400.
      throw badRequest(err instanceof Error ? err.message : 'Nao consegui ler o QR Code')
    }

    // Nota ja importada: avisar ANTES da conferencia evita o usuario revisar
    // 30 itens para so entao descobrir que ja tinha lancado essa compra.
    const existing = await prisma.invoice.findUnique({
      where: { chaveAcesso: result.chave },
      select: { id: true, createdAt: true, emitente: true, tenantId: true },
    })

    // Carrega o cadastro uma vez so e casa em memoria: sao poucas centenas de
    // insumos, e uma query por item deixaria a conferencia lenta no celular.
    const ingredients = await prisma.ingredient.findMany({
      where: { tenantId, active: true },
      select: { id: true, name: true, unit: true, barcode: true, stock: true, price: true },
    })

    const byBarcode = new Map(
      ingredients.filter((i) => i.barcode).map((i) => [i.barcode as string, i]),
    )

    const items = result.items.map((item) => {
      const exact = item.codigo ? byBarcode.get(item.codigo) : undefined

      let match: (typeof ingredients)[number] | undefined = exact
      let matchedBy: 'barcode' | 'nome' | null = exact ? 'barcode' : null
      let confidence = exact ? 1 : 0

      if (!match) {
        let best: (typeof ingredients)[number] | undefined
        let bestScore = 0
        for (const ing of ingredients) {
          const score = similarity(item.descricao, ing.name)
          if (score > bestScore) {
            bestScore = score
            best = ing
          }
        }
        if (best && bestScore >= SIMILARITY_THRESHOLD) {
          match = best
          matchedBy = 'nome'
          confidence = Number(bestScore.toFixed(2))
        }
      }

      return {
        ...item,
        match: match
          ? {
              ingredientId: match.id,
              name: match.name,
              unit: match.unit,
              stock: Number(match.stock),
              price: Number(match.price),
              matchedBy,
              confidence,
            }
          : null,
      }
    })

    return ok(res, {
      ...result,
      items,
      alreadyImported: existing
        ? {
            id: existing.id,
            importedAt: existing.createdAt,
            emitente: existing.emitente,
            // Uma nota de outro tenant nao pode nem ser revelada em detalhe.
            sameTenant: existing.tenantId === tenantId,
          }
        : null,
    })
  }),
)

// ---------------------------------------------------------------------------
// POST /api/scanner/stock-entry
// ---------------------------------------------------------------------------

const entryItemSchema = z
  .object({
    /** `link` soma no insumo existente; `create` cadastra e ja entra com saldo. */
    action: z.enum(['link', 'create']),
    ingredientId: z.string().trim().min(1).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    unit: z.string().trim().min(1).max(10).optional(),
    barcode: z.string().trim().max(64).optional().nullable(),
    codigo: z.string().trim().max(64).optional(),
    descricao: z.string().trim().max(240).optional(),
    quantity: z.coerce.number().positive().max(1_000_000),
    unitPrice: z.coerce.number().min(0).max(1_000_000),
  })
  .superRefine((item, ctx) => {
    // Validar o par action/campos aqui (e nao na rota) faz o erro apontar para
    // o item exato do formulario, em vez de uma mensagem generica no topo.
    if (item.action === 'link' && !item.ingredientId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ingredientId'],
        message: 'Informe o insumo para vincular',
      })
    }
    if (item.action === 'create' && (!item.name || !item.unit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'Novo insumo exige nome e unidade',
      })
    }
  })

const stockEntrySchema = z.object({
  chaveAcesso: z.string().trim().regex(/^\d{44}$/).optional(),
  emitente: z.string().trim().max(160).optional(),
  emitenteCnpj: z.string().trim().max(24).optional(),
  emitenteUF: z.string().trim().max(2).optional(),
  numero: z.string().trim().max(20).optional(),
  serie: z.string().trim().max(10).optional(),
  dataEmissao: z.string().trim().optional(),
  valorTotal: z.coerce.number().min(0).optional(),
  items: z.array(entryItemSchema).min(1).max(300),
})

/**
 * Grava a entrada de estoque conferida.
 *
 * Tudo numa transacao unica: ou a compra inteira entra, ou nada entra. Uma
 * importacao pela metade seria pior do que nenhuma — o usuario nao teria como
 * saber quais dos 30 itens ja tinham sido lancados e reimportar duplicaria os
 * que passaram.
 */
router.post(
  '/stock-entry',
  // O mount libera a rota para quem tem `scanner:use` OU `ingredients:manage`,
  // porque consultar um codigo e inofensivo. Gravar nao e: aqui a exigencia
  // sobe para `ingredients:manage`.
  requireStockAccess,
  validate({ body: stockEntrySchema }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const body = req.body as z.infer<typeof stockEntrySchema>

    // -- Barreira de duplicidade -------------------------------------------
    // `chaveAcesso` e unica no banco, entao sem esta checagem a segunda
    // importacao morreria com erro de constraint do Prisma (P2002), que chega
    // ao usuario como "erro interno". Aqui vira uma mensagem que explica.
    if (body.chaveAcesso) {
      const dup = await prisma.invoice.findUnique({
        where: { chaveAcesso: body.chaveAcesso },
        select: { id: true, createdAt: true, tenantId: true },
      })
      if (dup) {
        throw conflict(
          dup.tenantId === tenantId
            ? `Esta nota ja foi importada em ${dup.createdAt.toLocaleDateString('pt-BR')}. O estoque nao foi alterado.`
            : 'Esta nota ja foi importada em outra loja.',
          'INVOICE_ALREADY_IMPORTED',
        )
      }
    }

    // -- Conferencia previa dos vinculos -----------------------------------
    // Feita fora da transacao para falhar barato: se um insumo foi apagado
    // enquanto a tela de conferencia estava aberta, o usuario descobre agora.
    const linkIds = body.items
      .filter((i) => i.action === 'link' && i.ingredientId)
      .map((i) => i.ingredientId as string)

    const linked = await prisma.ingredient.findMany({
      where: { id: { in: linkIds }, tenantId },
      select: { id: true, name: true, stock: true },
    })
    const linkedById = new Map(linked.map((i) => [i.id, i]))

    const missing = linkIds.filter((id) => !linkedById.has(id))
    if (missing.length > 0) {
      throw badRequest(
        `${missing.length} insumo(s) da lista nao existem mais. Recarregue a conferencia.`,
        'INGREDIENT_GONE',
      )
    }

    // -- Codigos de barras em conflito -------------------------------------
    // `barcode` e unico por tenant. Deixar o banco reclamar produziria um erro
    // cru; conferir antes permite dizer de qual item e de qual insumo se trata.
    const newBarcodes = body.items
      .filter((i) => i.action === 'create' && i.barcode)
      .map((i) => i.barcode as string)

    if (newBarcodes.length > 0) {
      const clash = await prisma.ingredient.findFirst({
        where: { tenantId, barcode: { in: newBarcodes } },
        select: { name: true, barcode: true },
      })
      if (clash) {
        throw conflict(
          `O codigo de barras ${clash.barcode} ja pertence a "${clash.name}". Vincule o item a esse insumo em vez de criar um novo.`,
          'BARCODE_TAKEN',
        )
      }

      const duplicatesInPayload = newBarcodes.filter(
        (b, i) => newBarcodes.indexOf(b) !== i,
      )
      if (duplicatesInPayload.length > 0) {
        throw badRequest(
          `O codigo ${duplicatesInPayload[0]} aparece em mais de um item novo. Vincule os itens repetidos ao mesmo insumo.`,
          'BARCODE_DUPLICATED',
        )
      }
    }

    // -- Gravacao ----------------------------------------------------------
    const outcome = await prisma.$transaction(async (tx) => {
      const applied: Array<{
        name: string
        unit: string
        quantity: number
        before: number
        after: number
        createdIngredient: boolean
        ingredientId: string
      }> = []

      /**
       * Insumo resolvido por POSICAO do item na lista original.
       *
       * Nao da para usar o indice de `applied` para achar o insumo de um item:
       * `applied` so recebe as linhas efetivamente gravadas, entao qualquer
       * item pulado desloca todos os seguintes. Esse desalinhamento gravaria a
       * nota com o item apontando para o insumo errado — um erro silencioso,
       * que so apareceria muito depois num CMV inexplicavel.
       */
      const ingredientIdByIndex = new Map<number, string>()

      for (const [index, item] of body.items.entries()) {
        if (item.action === 'create') {
          const name = item.name as string
          const unit = item.unit as string

          // SKU derivado do nome, com sufixo do relogio para nao colidir com
          // um cadastro antigo de nome parecido.
          const sku =
            normalize(name).replace(/\s+/g, '-').slice(0, 24) +
            '-' +
            Date.now().toString(36).slice(-4)

          const createdIng = await tx.ingredient.create({
            data: {
              tenantId,
              name,
              unit,
              sku,
              barcode: item.barcode || null,
              price: dec2(item.unitPrice),
              stock: dec4(item.quantity),
              minimumStock: dec4(0),
              active: true,
            },
          })

          ingredientIdByIndex.set(index, createdIng.id)
          applied.push({
            name: createdIng.name,
            unit: createdIng.unit,
            quantity: item.quantity,
            before: 0,
            after: item.quantity,
            createdIngredient: true,
            ingredientId: createdIng.id,
          })
          continue
        }

        const target = linkedById.get(item.ingredientId as string)
        if (!target) continue

        const before = Number(target.stock)
        const after = before + item.quantity

        const updated = await tx.ingredient.update({
          where: { id: target.id },
          data: {
            stock: dec4(after),
            // O ultimo preco pago vira o custo corrente do insumo, que e o que
            // o CMV e a precificacao consultam. Compra sem valor (bonificacao,
            // brinde) nao mexe no preco, senao zeraria o custo do produto.
            ...(item.unitPrice > 0 ? { price: dec2(item.unitPrice) } : {}),
          },
        })

        ingredientIdByIndex.set(index, updated.id)
        applied.push({
          name: updated.name,
          unit: updated.unit,
          quantity: item.quantity,
          before,
          after,
          createdIngredient: false,
          ingredientId: updated.id,
        })
      }

      // -- Nota fiscal ------------------------------------------------------
      // Guardar a nota e o que torna a importacao auditavel e idempotente: sem
      // o registro da chave, a mesma compra poderia ser lancada duas vezes.
      let invoiceId: string | null = null
      if (body.chaveAcesso) {
        const total =
          body.valorTotal ??
          body.items.reduce((acc, i) => acc + i.quantity * i.unitPrice, 0)

        const emissao = body.dataEmissao ? new Date(body.dataEmissao) : new Date()

        const invoice = await tx.invoice.create({
          data: {
            tenantId,
            chaveAcesso: body.chaveAcesso,
            numero: body.numero ?? body.chaveAcesso.slice(25, 34),
            serie: body.serie ?? body.chaveAcesso.slice(22, 25),
            emitente: body.emitente ?? 'Emitente nao identificado',
            emitenteDoc: body.emitenteCnpj ?? body.chaveAcesso.slice(6, 20),
            emitentUF: body.emitenteUF ?? null,
            dataEmissao: Number.isNaN(emissao.getTime()) ? new Date() : emissao,
            valorTotal: dec2(total),
            status: 'processed',
            items: {
              create: body.items.map((item, index) => ({
                numeroItem: index + 1,
                codigoProduto: item.codigo ?? '',
                descricao: item.descricao ?? item.name ?? 'Item',
                unit: item.unit ?? 'un',
                quantity: dec4(item.quantity),
                unitPrice: dec4(item.unitPrice),
                totalPrice: dec2(item.quantity * item.unitPrice),
                ingredientId: ingredientIdByIndex.get(index) ?? null,
              })),
            },
          },
        })
        invoiceId = invoice.id
      }

      return { applied, invoiceId }
    })

    return created(res, serialize({
      invoiceId: outcome.invoiceId,
      itemsApplied: outcome.applied.length,
      createdIngredients: outcome.applied.filter((a) => a.createdIngredient).length,
      details: outcome.applied,
    }))
  }),
)

export default router
