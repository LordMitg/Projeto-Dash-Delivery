/**
 * Rotas de pedidos — o coracao do PDV.
 *
 * BUGS E LACUNAS CORRIGIDOS:
 *  1. NAO baixava estoque. Vender 100 marmitas nao mexia em 1 g de insumo.
 *  2. `generateOrderNumber()` usava Math.random(): dois pedidos simultaneos
 *     podiam receber o mesmo numero. Agora e sequencial por dia, dentro da
 *     transacao, com unicidade garantida pelo banco.
 *  3. Nao havia taxa de entrega nem calculo de troco.
 *  4. Nao validava se a loja estava aberta.
 *  5. Adicionais nao existiam.
 *  6. `Math.floor(Number(item.quantity))` aceitava NaN e quantidade negativa
 *     (NaN passava pelo `Math.max(1, ...)` como NaN, corrompendo o total).
 *  7. Cancelar pedido nao devolvia estoque.
 *  8. Nao emitia evento em tempo real para a tela da cozinha.
 */
import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import {
  asyncHandler,
  ok,
  createdResponse,
  notFound,
  conflict,
  badRequest,
  requireAuth,
  tenantOf,
  serialize,
} from '../lib/http.js'
import { validate, z, idParam, money, positiveInt } from '../lib/validate.js'
import { applyStockDeduction, restoreStock, type StockConsumption } from '../services/stockService.js'
import { findOpenRegister, recordSaleInCash } from '../services/cashService.js'
import { emitToTenant } from '../lib/realtime.js'
import { env } from '../config/env.js'

const router = Router()

const dec = (v: number) => new Prisma.Decimal(v.toFixed(2))

/** Arredonda para centavos, evitando o residuo de ponto flutuante nas somas. */
const round2 = (v: number) => Math.round(v * 100) / 100

/** Fluxo de status permitido no Kanban da cozinha. */
const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'dispatched',
  'delivered',
  'cancelled',
] as const

type OrderStatus = (typeof ORDER_STATUSES)[number]

/**
 * Transicoes validas. Impede, por exemplo, que um pedido entregue volte
 * para "em preparo" ou que um cancelado seja reaberto.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'preparing', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['dispatched', 'delivered', 'cancelled'],
  dispatched: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
}

// ---------------------------------------------------------------------------
// NUMERO DO PEDIDO
// ---------------------------------------------------------------------------

/**
 * Gera o numero sequencial do dia (ex: 20260805-0001).
 *
 * Roda DENTRO da transacao e conta os pedidos do dia da propria loja.
 * O indice unico de `orderNumber` no banco e a rede de seguranca final:
 * se duas caixas registrarem no mesmo milissegundo, uma recebe erro de
 * unicidade e o retry resolve.
 */
async function nextOrderNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const prefix =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}`

  const countToday = await tx.order.count({
    where: { tenantId, createdAt: { gte: startOfDay } },
  })

  return `${prefix}-${String(countToday + 1).padStart(4, '0')}`
}

// ---------------------------------------------------------------------------
// TAXA DE ENTREGA
// ---------------------------------------------------------------------------

interface DeliveryZone {
  name: string
  fee: number
}

/**
 * Resolve a taxa de entrega no SERVIDOR.
 *
 * Nunca confia no valor enviado pelo cliente: o front informa apenas o bairro,
 * e o servidor consulta a tabela de zonas da loja. Assim ninguem consegue
 * mandar `deliveryFee: 0` na requisicao e frustrar a cobranca.
 */
function resolveDeliveryFee(
  orderType: string,
  zoneName: string | null | undefined,
  tenant: { deliveryFeeBase: Prisma.Decimal; deliveryZones: Prisma.JsonValue },
): number {
  // Balcao e mesa nao tem entrega.
  if (orderType !== 'delivery') return 0

  const zones = Array.isArray(tenant.deliveryZones)
    ? (tenant.deliveryZones as unknown as DeliveryZone[])
    : []

  if (zoneName) {
    const zone = zones.find((z) => z?.name?.toLowerCase() === zoneName.toLowerCase())
    if (zone && Number.isFinite(Number(zone.fee))) return Number(zone.fee)
  }

  return Number(tenant.deliveryFeeBase)
}

// ---------------------------------------------------------------------------
// GET /api/orders — lista (base do Kanban)
// ---------------------------------------------------------------------------

const listQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve ser AAAA-MM-DD').optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  // `all=true` ignora o filtro de data (usado em relatorios).
  all: z.enum(['true', 'false']).optional(),
  /** Filtro do painel: id de um canal de venda cadastrado. */
  channelId: z.string().optional(),
  /** Filtro do painel por tipo de pedido (as abas Balcao / Delivery). */
  orderType: z.enum(['delivery', 'balcao', 'mesa']).optional(),
  /** Busca por numero do pedido, nome ou telefone do cliente. */
  search: z.string().trim().min(1).max(60).optional(),
})

router.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const { date, status, all, channelId, orderType, search } =
      req.query as unknown as z.infer<typeof listQuery>

    const where: Prisma.OrderWhereInput = { tenantId }

    if (all !== 'true') {
      // Monta o intervalo do dia no fuso do servidor.
      const base = date ? new Date(`${date}T00:00:00`) : new Date()
      const start = new Date(base.getFullYear(), base.getMonth(), base.getDate())
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      where.createdAt = { gte: start, lt: end }
    }

    if (status) where.status = status
    if (channelId) where.salesChannelId = channelId
    if (orderType) where.orderType = orderType

    /**
     * Busca no servidor, e nao filtrando o array no navegador: o painel carrega
     * apenas o dia, mas o balcao pesquisa pedido de ontem pelo telefone, e esse
     * pedido nunca estaria na lista local para ser filtrado.
     */
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { phone: { contains: search } } },
      ]
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true, address: true } },
        orderItems: {
          include: { product: { select: { id: true, name: true, category: true } } },
        },
        delivery: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        // O painel mostra a origem de cada pedido (iFood, Salao, Balcao). Sem
        // este `include` o cartao ficava sem etiqueta de canal e as abas de
        // filtro nao tinham dado para filtrar.
        salesChannel: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return ok(res, serialize(orders))
  }),
)

// ---------------------------------------------------------------------------
// GET /api/orders/:id
// ---------------------------------------------------------------------------

router.get(
  '/:id',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)

    const order = await prisma.order.findFirst({
      where: { id: req.params.id, tenantId },
      include: {
        customer: true,
        orderItems: { include: { product: true } },
        delivery: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        salesChannel: { select: { id: true, name: true, slug: true } },
      },
    })
    if (!order) throw notFound('Pedido nao encontrado')

    return ok(res, serialize(order))
  }),
)

// ---------------------------------------------------------------------------
// POST /api/orders — registrar venda
// ---------------------------------------------------------------------------

const addonInput = z.object({
  addonId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(20).default(1),
})

const itemInput = z.object({
  productId: z.string().min(1, 'Produto obrigatorio'),
  quantity: positiveInt,
  observations: z.string().trim().max(300).nullish(),
  /** Obrigatorio quando o produto e um combo com proteinas a escolha. */
  selectedProteinId: z.string().min(1).nullish(),
  addons: z.array(addonInput).max(20).default([]),
})

const createOrderSchema = z.object({
  items: z.array(itemInput).min(1, 'O pedido precisa de ao menos 1 item'),
  customerId: z.string().min(1).nullish(),
  newCustomer: z
    .object({
      name: z.string().min(1, 'Informe o nome do cliente').trim(),
      phone: z.string().trim().default(''),
      address: z.string().trim().default(''),
      neighborhood: z.string().trim().default(''),
      city: z.string().trim().default(''),
      state: z.string().trim().default(''),
      zipCode: z.string().trim().default(''),
    })
    .nullish(),
  orderType: z.enum(['delivery', 'balcao', 'mesa']).default('delivery'),
  paymentMethod: z.enum(['cash', 'credit', 'debit', 'pix', 'voucher', 'fiado']).default('cash'),
  /**
   * Pagamento misto: uma entrada por forma usada na venda.
   *
   * Opcional para nao quebrar quem ainda envia so `paymentMethod` (o cardapio
   * publico, por exemplo). Quando vem preenchido, a soma tem de fechar com o
   * total calculado no servidor — ver a validacao na etapa 5.
   */
  payments: z
    .array(
      z.object({
        method: z.enum(['cash', 'credit', 'debit', 'pix', 'voucher', 'fiado']),
        amount: money.refine((v) => v > 0, 'Cada pagamento deve ser maior que zero'),
        /** Nota entregue pelo cliente nesta parcela em especie. */
        changeFor: money.nullish(),
        cardBrand: z.string().trim().max(40).nullish(),
      }),
    )
    .max(6, 'No maximo 6 formas de pagamento por venda')
    .optional(),
  /** Bairro para calcular a taxa de entrega. */
  deliveryZone: z.string().trim().nullish(),
  discount: money.default(0),
  /** Valor em dinheiro entregue pelo cliente (para calcular o troco). */
  changeFor: money.nullish(),
  channelSlug: z.string().trim().nullish(),
  observations: z.string().trim().max(500).nullish(),
})

router.post(
  '/',
  validate({ body: createOrderSchema }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req)
    const tenantId = auth.tenantId
    const body = req.body as z.infer<typeof createOrderSchema>

    // ---- 1. Loja precisa estar aberta ----------------------------------
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { isOpen: true, deliveryFeeBase: true, deliveryZones: true },
    })
    if (!tenant) throw notFound('Loja nao encontrada')
    if (!tenant.isOpen) {
      throw conflict(
        'A loja esta fechada. Abra a loja no painel antes de registrar vendas.',
        'STORE_CLOSED',
      )
    }

    // ---- 2. Carregar produtos com ficha tecnica e adicionais -----------
    const productIds = [...new Set(body.items.map((i) => i.productId))]
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, tenantId, active: true },
      include: {
        technicalSheet: true,
        addons: { where: { active: true } },
      },
    })

    if (products.length !== productIds.length) {
      const found = new Set(products.map((p) => p.id))
      const missing = productIds.filter((id) => !found.has(id))
      throw badRequest(`Produto indisponivel ou inexistente: ${missing.join(', ')}`)
    }

    const productMap = new Map(products.map((p) => [p.id, p]))

    // ---- 3. Montar itens, adicionais e consumo de estoque --------------
    interface ComboOption {
      group?: string
      label?: string
      ingredientId?: string
      quantity?: number
    }

    const consumptions: StockConsumption[] = []
    const orderItemsData: Prisma.OrderItemCreateWithoutOrderInput[] = []
    let subtotal = 0

    for (const item of body.items) {
      const product = productMap.get(item.productId)!
      const qty = item.quantity
      const unitPrice = Number(product.price)

      // ---- 3a. Proteina do combo ----
      let proteinName: string | null = null
      let proteinIngredientId: string | null = null

      const comboOptions: ComboOption[] = Array.isArray(product.comboOptions)
        ? (product.comboOptions as unknown as ComboOption[])
        : []

      if (product.productType === 'combo' && comboOptions.length > 0) {
        if (!item.selectedProteinId) {
          throw badRequest(
            `"${product.name}" exige a escolha de uma proteina (${comboOptions
              .map((o) => o.label)
              .filter(Boolean)
              .join(', ')}).`,
          )
        }

        const chosen = comboOptions.find((o) => o.ingredientId === item.selectedProteinId)
        if (!chosen) {
          throw badRequest(
            `A proteina escolhida nao e uma opcao valida de "${product.name}".`,
          )
        }

        proteinName = chosen.label ?? null
        proteinIngredientId = chosen.ingredientId ?? null

        // Quantidade da proteina: usa a linha da ficha tecnica marcada como
        // proteina principal, se existir; senao usa o valor da propria opcao.
        const sheetProtein = product.technicalSheet.find(
          (l) => l.isMainProtein && l.ingredientId === chosen.ingredientId,
        )
        const proteinQty = sheetProtein
          ? Number(sheetProtein.quantity)
          : Number(chosen.quantity ?? 0)

        if (proteinIngredientId && proteinQty > 0) {
          consumptions.push({ ingredientId: proteinIngredientId, quantity: proteinQty * qty })
        }
      }

      // ---- 3b. Base da ficha tecnica (tudo que nao e proteina a escolha) ----
      for (const line of product.technicalSheet) {
        if (line.isMainProtein) continue // ja tratada acima
        consumptions.push({
          ingredientId: line.ingredientId,
          quantity: Number(line.quantity) * qty,
        })
      }

      // ---- 3c. Adicionais ----
      const addonMap = new Map(product.addons.map((a) => [a.id, a]))
      const frozenAddons: Array<{ addonId: string; name: string; price: number; quantity: number }> = []
      let addonsTotal = 0

      for (const chosenAddon of item.addons) {
        const addon = addonMap.get(chosenAddon.addonId)
        if (!addon) {
          throw badRequest(`Adicional invalido para "${product.name}"`)
        }
        if (chosenAddon.quantity > addon.maxQuantity) {
          throw badRequest(
            `"${addon.name}" permite no maximo ${addon.maxQuantity} por item.`,
          )
        }

        const addonPrice = Number(addon.price)
        // Multiplica pela quantidade do item: 2 marmitas com bacon = 2 bacons.
        const lineAddonTotal = addonPrice * chosenAddon.quantity * qty
        addonsTotal += lineAddonTotal

        frozenAddons.push({
          addonId: addon.id,
          name: addon.name,
          price: addonPrice,
          quantity: chosenAddon.quantity,
        })

        if (addon.ingredientId && addon.ingredientQty) {
          consumptions.push({
            ingredientId: addon.ingredientId,
            quantity: Number(addon.ingredientQty) * chosenAddon.quantity * qty,
          })
        }
      }

      // ---- 3d. Grupos obrigatorios ----
      const requiredGroups = [...new Set(product.addons.filter((a) => a.required).map((a) => a.groupName))]
      for (const group of requiredGroups) {
        const groupAddonIds = product.addons.filter((a) => a.groupName === group).map((a) => a.id)
        const chose = item.addons.some((a) => groupAddonIds.includes(a.addonId))
        if (!chose) {
          throw badRequest(`"${product.name}": escolha uma opcao do grupo "${group}".`)
        }
      }

      const lineSubtotal = unitPrice * qty + addonsTotal
      subtotal += lineSubtotal

      orderItemsData.push({
        product: { connect: { id: product.id } },
        quantity: qty,
        unitPrice: dec(unitPrice),
        subtotal: dec(lineSubtotal),
        observations: item.observations ?? null,
        selectedProteinId: proteinIngredientId,
        selectedProteinName: proteinName,
        addons: frozenAddons.length > 0 ? (frozenAddons as unknown as Prisma.InputJsonValue) : undefined,
        addonsTotal: dec(addonsTotal),
      })
    }

    // ---- 4. Taxa, desconto e total (sempre no servidor) ----------------
    const deliveryFee = resolveDeliveryFee(body.orderType, body.deliveryZone, tenant)
    const discount = Math.min(body.discount, subtotal)
    const totalAmount = subtotal + deliveryFee - discount

    if (totalAmount < 0) throw badRequest('O desconto nao pode ser maior que o total do pedido')

    // ---- 5. Pagamentos e troco ------------------------------------------
    // Normaliza os dois formatos aceitos numa lista unica de parcelas. Assim o
    // resto da rota (troco, caixa, `paymentMethod` principal) tem um so caminho
    // de codigo, em vez de um `if` a cada uso.
    const rawPayments =
      body.payments && body.payments.length > 0
        ? body.payments
        : [
            {
              method: body.paymentMethod,
              amount: totalAmount,
              changeFor: body.changeFor ?? null,
              cardBrand: null,
            },
          ]

    // A soma tem de fechar com o total do SERVIDOR. Sem isto, um cliente
    // adulterado enviaria R$ 5 de pagamento para um pedido de R$ 80 e a venda
    // entraria como paga.
    const paidSum = round2(rawPayments.reduce((s, p) => s + p.amount, 0))
    if (Math.abs(paidSum - round2(totalAmount)) > 0.01) {
      throw badRequest(
        `A soma dos pagamentos (R$ ${paidSum.toFixed(2)}) nao fecha com o total ` +
          `do pedido (R$ ${round2(totalAmount).toFixed(2)}).`,
      )
    }

    // Duas parcelas em dinheiro na mesma venda nao existem na pratica e
    // tornariam o troco ambiguo (qual das duas gerou o troco?).
    if (rawPayments.filter((p) => p.method === 'cash').length > 1) {
      throw badRequest('Use uma unica parcela em dinheiro por venda.')
    }

    let changeAmount: number | null = null
    let changeFor: number | null = null

    const paymentsData = rawPayments.map((p) => {
      let lineChangeFor: number | null = null
      let lineChange: number | null = null

      if (p.method === 'cash' && p.changeFor != null) {
        // Compara com o valor DESTA parcela, nao com o total: numa venda mista
        // de R$ 80 com R$ 30 em dinheiro, exigir R$ 80 em especie estaria errado.
        if (p.changeFor < p.amount) {
          throw badRequest(
            `O valor em dinheiro (R$ ${p.changeFor.toFixed(2)}) e menor que a parte ` +
              `paga em especie (R$ ${p.amount.toFixed(2)}).`,
          )
        }
        lineChangeFor = p.changeFor
        lineChange = round2(p.changeFor - p.amount)
        changeFor = lineChangeFor
        changeAmount = lineChange
      }

      return {
        method: p.method,
        amount: dec(p.amount),
        changeFor: lineChangeFor != null ? dec(lineChangeFor) : null,
        changeAmount: lineChange != null ? dec(lineChange) : null,
        cardBrand: p.cardBrand ?? null,
      }
    })

    // Forma principal = a de maior valor. E o que os relatorios antigos leem em
    // `Order.paymentMethod`; o detalhe fica em `payments`.
    const primaryMethod = rawPayments.reduce((a, b) => (b.amount > a.amount ? b : a)).method

    // Fiado nao entra como pago: virou divida do cliente. Se qualquer parcela
    // for fiado, a venda fica pendente ate a quitacao.
    const hasFiado = rawPayments.some((p) => p.method === 'fiado')

    // ---- 5b. Caixa aberto e obrigatorio ---------------------------------
    // Regra do negocio: toda venda pertence a um turno identificado. Sem isto o
    // fechamento nao teria com o que comparar a gaveta, e a conferencia seria
    // decorativa.
    const openRegister = await findOpenRegister(prisma, tenantId)
    if (!openRegister) {
      throw conflict(
        'O caixa esta fechado. Abra o caixa para comecar a registrar vendas.',
        'CASH_CLOSED',
      )
    }

    // ---- 6. Canal de venda ---------------------------------------------
    let channelId: string | null = null
    if (body.channelSlug) {
      const channel = await prisma.salesChannel.findFirst({
        where: { slug: body.channelSlug, tenantId, active: true },
        select: { id: true },
      })
      if (!channel) throw badRequest(`Canal de venda "${body.channelSlug}" nao encontrado`)
      channelId = channel.id
    }

    // ---- 7. Transacao: cliente + pedido + estoque + LTV ----------------
    const order = await prisma.$transaction(async (tx) => {
      // 7a. Cliente
      let customerId: string | null = body.customerId ?? null

      if (customerId) {
        // Garante que o cliente e da mesma loja.
        const exists = await tx.customer.findFirst({
          where: { id: customerId, tenantId },
          select: { id: true },
        })
        if (!exists) throw notFound('Cliente nao encontrado nesta loja')
      } else if (body.newCustomer?.name) {
        const nc = body.newCustomer
        const existing = nc.phone
          ? await tx.customer.findFirst({ where: { phone: nc.phone, tenantId } })
          : null

        if (existing) {
          customerId = existing.id
        } else {
          const createdCustomer = await tx.customer.create({
            data: {
              name: nc.name,
              phone: nc.phone,
              address: nc.address,
              // Bairro em coluna propria, nao concatenado no endereco: dentro de
              // `address` ele virava texto livre e nao servia para reencontrar a
              // taxa da zona no proximo pedido do mesmo cliente.
              neighborhood: nc.neighborhood || body.deliveryZone || null,
              city: nc.city,
              state: nc.state,
              zipCode: nc.zipCode,
              tenantId,
            },
          })
          customerId = createdCustomer.id
        }
      }

      // 7b. Baixa de estoque ANTES de criar o pedido:
      // se faltar insumo, nada e persistido.
      await applyStockDeduction(tx, tenantId, consumptions, env.ALLOW_NEGATIVE_STOCK)

      // 7c. Pedido
      const createdOrder = await tx.order.create({
        data: {
          orderNumber: await nextOrderNumber(tx, tenantId),
          status: 'pending',
          orderType: body.orderType,
          subtotal: dec(subtotal),
          deliveryFee: dec(deliveryFee),
          discount: dec(discount),
          totalAmount: dec(totalAmount),
          changeFor: changeFor != null ? dec(changeFor) : null,
          changeAmount: changeAmount != null ? dec(changeAmount) : null,
          paymentMethod: primaryMethod,
          paymentStatus: hasFiado ? 'pending' : 'paid',
          observations: body.observations ?? null,
          tenantId,
          createdById: auth.userId,
          customerId,
          salesChannelId: channelId,
          cashRegisterId: openRegister.id,
          orderItems: { create: orderItemsData },
          payments: { create: paymentsData },
        },
        include: {
          orderItems: { include: { product: { select: { id: true, name: true } } } },
          customer: true,
          payments: true,
        },
      })

      // 7c-bis. Lancamento no caixa, uma linha por forma de pagamento.
      // Dentro da MESMA transacao do pedido: se o caixa falhasse depois, a venda
      // existiria sem entrada no turno e o fechamento acusaria falta de dinheiro.
      await recordSaleInCash(tx, {
        registerId: openRegister.id,
        orderId: createdOrder.id,
        orderNumber: createdOrder.orderNumber,
        userId: auth.userId,
        payments: rawPayments.map((p) => ({ method: p.method, amount: p.amount })),
      })

      // 7c-ter. Primeira linha do historico: o pedido entrou.
      // O canal vai na `note` porque e o que o feed mostra ao lado do nome
      // ("Novo pedido #1053 recebido · Fernanda · Delivery").
      await tx.orderEvent.create({
        data: {
          tenantId,
          orderId: createdOrder.id,
          actorId: auth.userId,
          type: 'created',
          toStatus: 'pending',
          note: body.orderType,
        },
      })

      // 7d. LTV do cliente
      if (customerId) {
        await tx.customer.update({
          where: { id: customerId },
          data: {
            ltv: { increment: totalAmount },
            totalOrders: { increment: 1 },
            lastOrderAt: new Date(),
          },
        })
      }

      return createdOrder
    })

    const payload = serialize(order)

    // Avisa a cozinha e os outros dispositivos instantaneamente.
    emitToTenant(tenantId, 'order:created', payload)

    // Alerta de estoque baixo apos a venda.
    const low = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name FROM ingredients
      WHERE "tenantId" = ${tenantId} AND active = true AND stock <= "minimumStock"
    `
    if (low.length > 0) emitToTenant(tenantId, 'stock:low', low)

    return createdResponse(res, payload)
  }),
)

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/status — mover no Kanban
// ---------------------------------------------------------------------------

router.patch(
  '/:id/status',
  validate({
    params: idParam,
    body: z.object({
      status: z.enum(ORDER_STATUSES),
      /**
       * Motivo, usado no cancelamento. Sem ele o historico registra "cancelado"
       * sem dizer por que — e "cliente desistiu" e "faltou ingrediente" pedem
       * providencias opostas de quem le o painel depois.
       */
      reason: z.string().trim().max(200).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const auth = requireAuth(req)
    const { id } = req.params
    const { status, reason } = req.body as { status: OrderStatus; reason?: string }

    const order = await prisma.order.findFirst({
      where: { id, tenantId },
      include: { orderItems: { include: { product: { include: { technicalSheet: true } } } } },
    })
    if (!order) throw notFound('Pedido nao encontrado')

    const current = order.status as OrderStatus
    if (current === status) return ok(res, { id, status })

    if (!ALLOWED_TRANSITIONS[current]?.includes(status)) {
      throw conflict(
        `Nao e possivel mudar de "${current}" para "${status}".`,
        'INVALID_TRANSITION',
      )
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Cancelar devolve o estoque consumido.
      if (status === 'cancelled') {
        const consumptions: StockConsumption[] = []

        for (const item of order.orderItems) {
          // Proteina escolhida
          if (item.selectedProteinId) {
            const sheetProtein = item.product.technicalSheet.find(
              (l) => l.isMainProtein && l.ingredientId === item.selectedProteinId,
            )
            const options = Array.isArray(item.product.comboOptions)
              ? (item.product.comboOptions as unknown as Array<{ ingredientId?: string; quantity?: number }>)
              : []
            const opt = options.find((o) => o.ingredientId === item.selectedProteinId)
            const qtyPerUnit = sheetProtein ? Number(sheetProtein.quantity) : Number(opt?.quantity ?? 0)
            if (qtyPerUnit > 0) {
              consumptions.push({
                ingredientId: item.selectedProteinId,
                quantity: qtyPerUnit * item.quantity,
              })
            }
          }

          // Base da receita
          for (const line of item.product.technicalSheet) {
            if (line.isMainProtein) continue
            consumptions.push({
              ingredientId: line.ingredientId,
              quantity: Number(line.quantity) * item.quantity,
            })
          }

          // Adicionais congelados no item
          const addons = Array.isArray(item.addons)
            ? (item.addons as unknown as Array<{ addonId: string; quantity: number }>)
            : []
          if (addons.length > 0) {
            const addonRows = await tx.productAddon.findMany({
              where: { id: { in: addons.map((a) => a.addonId) }, tenantId },
            })
            for (const a of addons) {
              const row = addonRows.find((r) => r.id === a.addonId)
              if (row?.ingredientId && row.ingredientQty) {
                consumptions.push({
                  ingredientId: row.ingredientId,
                  quantity: Number(row.ingredientQty) * a.quantity * item.quantity,
                })
              }
            }
          }
        }

        await restoreStock(tx, tenantId, consumptions)

        // Desfaz o LTV do cliente.
        if (order.customerId) {
          await tx.customer.update({
            where: { id: order.customerId },
            data: {
              ltv: { decrement: Number(order.totalAmount) },
              totalOrders: { decrement: 1 },
            },
          })
        }
      }

      /**
       * O evento e gravado DENTRO da transacao, junto da mudanca de status.
       * Fora dela, um erro entre as duas escritas deixaria o pedido movido sem
       * registro no historico — exatamente o caso que o feed precisa explicar.
       */
      await tx.orderEvent.create({
        data: {
          tenantId,
          // `order.id` e nao `id` do params: o do params e `string | undefined`
          // sob `noUncheckedIndexedAccess`, e este ja veio validado do banco.
          orderId: order.id,
          actorId: auth.userId,
          type: status === 'cancelled' ? 'cancelled' : 'status',
          fromStatus: current,
          toStatus: status,
          note: reason ?? null,
        },
      })

      return tx.order.update({
        where: { id },
        data: {
          status,
          ...(status === 'delivered' ? { deliveredAt: new Date() } : {}),
        },
      })
    })

    const payload = serialize(updated)
    emitToTenant(tenantId, status === 'cancelled' ? 'order:cancelled' : 'order:status', payload)

    return ok(res, payload)
  }),
)

// ---------------------------------------------------------------------------
// PATCH /api/orders/:id/printed — registra que a comanda foi impressa
// ---------------------------------------------------------------------------

router.patch(
  '/:id/printed',
  validate({
    params: idParam,
    body: z.object({ type: z.enum(['kitchen', 'delivery']) }),
  }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const { id } = req.params
    const { type } = req.body as { type: 'kitchen' | 'delivery' }

    const result = await prisma.order.updateMany({
      where: { id, tenantId },
      data: type === 'kitchen' ? { printedKitchen: true } : { printedDelivery: true },
    })
    if (result.count === 0) throw notFound('Pedido nao encontrado')

    return ok(res, { id, printed: type })
  }),
)

export default router
