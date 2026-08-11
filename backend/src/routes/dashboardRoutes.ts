/**
 * Rotas do painel de Visao geral.
 *
 * Existe como rota propria, e nao dentro de `financialRoutes`, por causa de
 * QUEM pergunta: o financeiro responde "quanto sobrou no mes" e e restrito a
 * quem tem acesso a numeros de resultado; esta tela responde "como esta o dia
 * agora" e e a primeira coisa que o gerente de turno abre. Sao publicos
 * diferentes, permissoes diferentes e janelas de tempo diferentes.
 *
 * Um unico endpoint (`/overview`) devolve o painel inteiro de proposito. A
 * alternativa — um endpoint por cartao — faria a tela abrir com seis
 * requisicoes concorrentes que leem as MESMAS tabelas do MESMO dia, cada uma
 * repetindo a varredura de pedidos. Além do custo, os cartoes chegariam em
 * momentos diferentes e poderiam discordar entre si (o donut somando 84
 * pedidos enquanto o KPI ja mostra 86), o que destroi a confianca no painel.
 */
import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { asyncHandler, ok, tenantOf } from '../lib/http.js'
import { validate, z } from '../lib/validate.js'

const router = Router()

/**
 * Status que representam pedido vivo na operacao — o que a cozinha, a rota e o
 * cartao "Pedidos em andamento" ainda precisam acompanhar.
 */
const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'dispatched'] as const

/** Minutos a partir dos quais um pedido ativo conta como atrasado. */
const LATE_AFTER_MINUTES = 60

/** Margem abaixo da qual o produto entra no alerta (fracao, nao %). */
const LOW_MARGIN_THRESHOLD = 0.2

/** Quantos produtos o ranking de mais vendidos devolve. */
const TOP_PRODUCTS_LIMIT = 5

/** Nome de exibicao do tipo de pedido, para o feed nunca mostrar o slug cru. */
const ORDER_TYPE_LABELS: Record<string, string> = {
  delivery: 'Delivery',
  balcao: 'Balcão',
  mesa: 'Salão',
}

const overviewQuery = z.object({
  /** Dia a analisar, `YYYY-MM-DD`. Ausente = hoje. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
    .optional(),
})

/** Comeco e fim (exclusivo) do dia informado, no fuso do servidor. */
function dayRange(date?: string): { start: Date; end: Date } {
  const base = date ? new Date(`${date}T00:00:00`) : new Date()
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

interface DaySummary {
  revenue: number
  orders: number
  averageTicket: number
  /**
   * Faturamento menos o custo dos insumos vendidos. E "estimado" porque usa o
   * `costPrice` congelado no produto, nao o custo real do lote que saiu do
   * estoque — e por nao descontar despesa fixa, que nao e do dia.
   */
  estimatedProfit: number
}

/**
 * Resume um intervalo: faturamento, pedidos, ticket e lucro estimado.
 *
 * Conta pedidos NAO CANCELADOS, e nao apenas os `paid`. No delivery o dinheiro
 * costuma entrar na entrega: filtrar por pago mostraria, as 19h, um faturamento
 * menor que o que a loja de fato vendeu no dia, e o gerente perderia a confianca
 * no painel justamente no horario de pico. Cancelado, sim, sai da conta — nunca
 * foi venda.
 */
async function summarize(tenantId: string, start: Date, end: Date): Promise<DaySummary> {
  const where: Prisma.OrderWhereInput = {
    tenantId,
    status: { not: 'cancelled' },
    createdAt: { gte: start, lt: end },
  }

  const [agg, items] = await Promise.all([
    prisma.order.aggregate({
      where,
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    // O custo vem dos itens, entao precisa da varredura de itens do dia; o
    // `aggregate` acima nao alcanca `product.costPrice`.
    prisma.orderItem.findMany({
      where: { order: where },
      select: { quantity: true, product: { select: { costPrice: true } } },
    }),
  ])

  const revenue = Number(agg._sum.totalAmount ?? 0)
  const orders = agg._count._all
  const cost = items.reduce((sum, item) => sum + Number(item.product.costPrice) * item.quantity, 0)

  return {
    revenue,
    orders,
    averageTicket: orders > 0 ? revenue / orders : 0,
    estimatedProfit: revenue - cost,
  }
}

// ---------------------------------------------------------------------------
// GET /api/dashboard/overview?date=YYYY-MM-DD
// ---------------------------------------------------------------------------

router.get(
  '/overview',
  validate({ query: overviewQuery }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const { date } = req.query as unknown as z.infer<typeof overviewQuery>

    const { start, end } = dayRange(date)
    // Dia anterior, para o "vs. ontem" dos cartoes.
    const previousStart = new Date(start)
    previousStart.setDate(previousStart.getDate() - 1)

    const dayWhere: Prisma.OrderWhereInput = {
      tenantId,
      status: { not: 'cancelled' },
      createdAt: { gte: start, lt: end },
    }

    const [today, yesterday, dayOrders, channels, topItems, ingredients, products] =
      await Promise.all([
        summarize(tenantId, start, end),
        summarize(tenantId, previousStart, start),

        /**
         * Pedidos do dia com o minimo para tres coisas ao mesmo tempo: a curva
         * por hora, o rateio por canal e a lista de "em andamento". Uma
         * varredura, tres cartoes — em vez de tres consultas quase iguais.
         */
        prisma.order.findMany({
          where: dayWhere,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            orderType: true,
            totalAmount: true,
            paymentStatus: true,
            createdAt: true,
            customer: { select: { name: true } },
            salesChannel: { select: { id: true, name: true, slug: true } },
          },
          orderBy: { createdAt: 'desc' },
        }),

        // Canais cadastrados, para nomear o rateio.
        prisma.salesChannel.findMany({
          where: { tenantId },
          select: { id: true, name: true, slug: true },
        }),

        // Mais vendidos: agrupa no banco em vez de somar no Node, porque o
        // volume de itens de um dia cheio nao cabe bem na memoria da API.
        prisma.orderItem.groupBy({
          by: ['productId'],
          where: { order: dayWhere },
          _sum: { quantity: true },
          orderBy: { _sum: { quantity: 'desc' } },
          take: TOP_PRODUCTS_LIMIT,
        }),

        // Alerta de estoque: so insumo com minimo definido. Sem isso, todo
        // insumo zerado (inclusive o que nunca foi cadastrado direito) viraria
        // alerta e o cartao perderia utilidade por excesso de ruido.
        prisma.ingredient.findMany({
          where: { tenantId, minimumStock: { gt: 0 } },
          select: { id: true, name: true, stock: true, minimumStock: true, unit: true },
        }),

        // Alerta de margem: precisa de preco e custo para dividir.
        prisma.product.findMany({
          where: { tenantId, active: true, price: { gt: 0 } },
          select: { id: true, name: true, price: true, costPrice: true },
        }),
      ])

    // ---- Curva por hora -----------------------------------------------------
    // 24 baldes fixos, mesmo vazios: um grafico que nasce so com as horas que
    // tiveram venda comprime o eixo e sugere movimento onde nao houve.
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0, orders: 0 }))
    for (const order of dayOrders) {
      const bucket = hourly[order.createdAt.getHours()]
      if (!bucket) continue
      bucket.revenue += Number(order.totalAmount)
      bucket.orders += 1
    }

    // ---- Rateio por canal ---------------------------------------------------
    /**
     * Pedido sem canal cai no rotulo do seu TIPO (Balcao, Delivery, Mesa), e nao
     * em um balde "sem canal". Venda feita no PDV nasce sem `salesChannelId`, e
     * num sistema recem-instalado isso seria a maioria: o donut mostraria uma
     * fatia gigante e anonima, escondendo a unica informacao que ele deveria
     * dar. O tipo do pedido e a verdade disponivel, entao e o que aparece.
     */
    const TYPE_LABEL: Record<string, string> = {
      delivery: 'Delivery próprio',
      balcao: 'Balcão',
      mesa: 'Salão',
    }
    const channelMap = new Map<string, { name: string; orders: number; revenue: number }>()
    for (const channel of channels) {
      channelMap.set(channel.id, { name: channel.name, orders: 0, revenue: 0 })
    }
    for (const order of dayOrders) {
      const key = order.salesChannel?.id ?? `type:${order.orderType}`
      const fallbackName = TYPE_LABEL[order.orderType] ?? order.orderType
      const entry = channelMap.get(key) ?? { name: fallbackName, orders: 0, revenue: 0 }
      entry.orders += 1
      entry.revenue += Number(order.totalAmount)
      channelMap.set(key, entry)
    }
    const channelTotals = [...channelMap.entries()]
      // Canal cadastrado mas sem venda no dia nao entra: legenda com "0%" ocupa
      // espaco sem informar.
      .filter(([, v]) => v.orders > 0)
      .map(([id, v]) => ({
        id,
        name: v.name,
        orders: v.orders,
        revenue: v.revenue,
        share: today.orders > 0 ? (v.orders / today.orders) * 100 : 0,
      }))
      .sort((a, b) => b.orders - a.orders)

    // ---- Mais vendidos ------------------------------------------------------
    const topProductIds = topItems.map((i) => i.productId)
    const topProductRows = topProductIds.length
      ? await prisma.product.findMany({
          where: { id: { in: topProductIds } },
          select: { id: true, name: true, imageUrl: true },
        })
      : []
    const topProducts = topItems.map((item) => {
      const product = topProductRows.find((p) => p.id === item.productId)
      return {
        id: item.productId,
        name: product?.name ?? 'Produto removido',
        imageUrl: product?.imageUrl ?? null,
        quantity: Number(item._sum.quantity ?? 0),
      }
    })

    // ---- Pedidos em andamento ----------------------------------------------
    const now = Date.now()
    const inProgress = dayOrders
      .filter((o) => (ACTIVE_STATUSES as readonly string[]).includes(o.status))
      .map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        orderType: o.orderType,
        total: Number(o.totalAmount),
        paymentStatus: o.paymentStatus,
        channel: o.salesChannel?.name ?? TYPE_LABEL[o.orderType] ?? o.orderType,
        customerName: o.customer?.name ?? null,
        minutes: Math.max(0, Math.floor((now - o.createdAt.getTime()) / 60000)),
        createdAt: o.createdAt,
      }))

    // ---- Alertas ------------------------------------------------------------
    const lowStock = ingredients.filter((i) => Number(i.stock) <= Number(i.minimumStock))
    const lateOrders = inProgress.filter((o) => o.minutes >= LATE_AFTER_MINUTES)
    const lowMargin = products.filter((p) => {
      const price = Number(p.price)
      return price > 0 && (price - Number(p.costPrice)) / price < LOW_MARGIN_THRESHOLD
    })

    return ok(res, {
      date: start,
      kpis: { today, yesterday },
      hourly,
      channels: channelTotals,
      topProducts,
      inProgress,
      alerts: {
        lowStock: {
          count: lowStock.length,
          items: lowStock.slice(0, 5).map((i) => ({
            id: i.id,
            name: i.name,
            stock: Number(i.stock),
            minimumStock: Number(i.minimumStock),
            unit: i.unit,
          })),
        },
        lateOrders: {
          count: lateOrders.length,
          thresholdMinutes: LATE_AFTER_MINUTES,
        },
        lowMargin: {
          count: lowMargin.length,
          thresholdPerc: LOW_MARGIN_THRESHOLD * 100,
          items: lowMargin.slice(0, 5).map((p) => ({
            id: p.id,
            name: p.name,
            marginPerc: ((Number(p.price) - Number(p.costPrice)) / Number(p.price)) * 100,
          })),
        },
      },
    })
  }),
)

// ---------------------------------------------------------------------------
// GET /api/dashboard/activity — feed de Atualizacoes do painel de pedidos
// ---------------------------------------------------------------------------

const activityQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

/**
 * Ultimos acontecimentos do dia, do mais novo para o mais antigo.
 *
 * Le a tabela `order_events` em vez de reconstruir o feed a partir dos eventos
 * de socket: socket so alcanca quem estava com a aba aberta na hora. Quem chega
 * as 15h, ou recarrega a pagina, precisa ver o que aconteceu antes — inclusive o
 * motivo de um cancelamento.
 */
router.get(
  '/activity',
  validate({ query: activityQuery }),
  asyncHandler(async (req, res) => {
    const tenantId = tenantOf(req)
    const { date, limit } = req.query as unknown as z.infer<typeof activityQuery>

    const { start, end } = dayRange(date)

    /**
     * Filtra pela data do PEDIDO, nao pela data do evento.
     *
     * Antes o filtro era `orderEvent.createdAt`, e o feed passava a falar de
     * pedidos que o quadro nao mostrava: um pedido das 23h50 entregue a 00h10
     * gera evento "amanha" enquanto o pedido continua sendo de "hoje". Foi visto
     * no navegador — quadro com 2 pedidos e feed com 14 atualizacoes de outros
     * 30. Amarrar o feed a data do pedido faz as duas metades da tela contarem
     * a mesma historia, que e a razao de estarem lado a lado.
     */
    const events = await prisma.orderEvent.findMany({
      where: { tenantId, order: { createdAt: { gte: start, lt: end } } },
      orderBy: { createdAt: 'desc' },
      take: limit ?? 30,
      select: {
        id: true,
        type: true,
        fromStatus: true,
        toStatus: true,
        note: true,
        createdAt: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            orderType: true,
            customer: { select: { name: true } },
            salesChannel: { select: { name: true } },
          },
        },
        actor: { select: { firstName: true, lastName: true } },
      },
    })

    return ok(
      res,
      events.map((e) => ({
        id: e.id,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
        orderId: e.order.id,
        orderNumber: e.order.orderNumber,
        // O feed identifica o pedido pelo cliente; sem cliente cadastrado
        // (balcao rapido) cai no canal ou no tipo, nunca em branco.
        subject:
          e.order.customer?.name ??
          e.order.salesChannel?.name ??
          ORDER_TYPE_LABELS[e.order.orderType] ??
          'Balcão',
        actor: e.actor ? `${e.actor.firstName} ${e.actor.lastName}`.trim() : null,
      })),
    )
  }),
)

// ---------------------------------------------------------------------------
// GET /api/dashboard/channels — lista enxuta para os filtros
// ---------------------------------------------------------------------------

/**
 * Duplica de proposito a listagem que ja existe em `GET /api/pricing/channels`.
 * Aquela vive atras de `pricing:view`, permissao de quem define margem e preco;
 * quem toca o turno costuma nao te-la e ficaria com o seletor "Todos os canais"
 * vazio no painel de pedidos. Aqui devolvemos apenas id, nome e slug — nenhuma
 * taxa de plataforma, nada de margem alvo. O dado sensivel continua restrito.
 */
router.get(
  '/channels',
  asyncHandler(async (req, res) => {
    const channels = await prisma.salesChannel.findMany({
      where: { tenantId: tenantOf(req), active: true },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    })
    return ok(res, channels)
  }),
)

export default router
