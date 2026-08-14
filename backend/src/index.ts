/**
 * Bootstrap do servidor.
 *
 * Mudancas em relacao a versao anterior:
 *  - Um unico middleware de autenticacao (antes eram dois, com segredos de
 *    fallback diferentes, e cada rota lia um campo que o outro nao preenchia).
 *  - Uma unica instancia de PrismaClient (antes cada arquivo de rota criava a
 *    sua, abrindo um pool de conexoes por arquivo).
 *  - Error handler registrado DEPOIS das rotas e antes do 404, tratando
 *    AppError e erros do Zod/Prisma de forma consistente.
 *  - CORS lendo as origens da configuracao, em vez de hardcode de localhost.
 */
import express, { type Request, type Response } from 'express'
import cors from 'cors'

import { corsOriginCheck, env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import { errorHandler, notFoundHandler } from './lib/http.js'
import {
  authenticate,
  requireFinancialAccess,
  requirePermission,
  verifyToken,
} from './middleware/auth.js'
import { authLimiter } from './middleware/rateLimit.js'
import { setRealtimeServer, tenantRoom } from './lib/realtime.js'
import { Server as SocketIOServer } from 'socket.io'

// Rotas
import authRoutes from './routes/authRoutes.js'
import ingredientRoutes from './routes/ingredientRoutes.js'
import productRoutes from './routes/productRoutes.js'
import menuRoutes from './routes/menuRoutes.js'
import orderRoutes from './routes/orderRoutes.js'
import kitchenRoutes from './routes/kitchenRoutes.js'
import deliveryRoutes from './routes/deliveryRoutes.js'
import driverRoutes from './routes/driverRoutes.js'
import purchaseRoutes from './routes/purchaseRoutes.js'
import customerRoutes from './routes/customerRoutes.js'
import financialRoutes from './routes/financialRoutes.js'
import financeCenterRoutes from './routes/financeCenterRoutes.js'
import dashboardRoutes from './routes/dashboardRoutes.js'
import cashRoutes from './routes/cashRoutes.js'
import payableRoutes from './routes/payableRoutes.js'
import invoiceRoutes from './routes/invoiceRoutes.js'
import scannerRoutes from './routes/scannerRoutes.js'
import pricingRoutes from './routes/pricingRoutes.js'
import storeRoutes from './routes/storeRoutes.js'
import publicRoutes from './routes/publicRoutes.js'
import tenantRoutes from './routes/tenantRoutes.js'
import userRoutes from './routes/userRoutes.js'
import { uploadRoutes, UPLOAD_ROOT } from './routes/uploadRoutes.js'

const app = express()

app.set('trust proxy', 1)

app.use(
  cors({
    // Funcao, nao lista: em desenvolvimento tambem aceita IPs de LAN privada,
    // para o scanner no celular funcionar sem editar o .env a cada rede nova.
    origin: corsOriginCheck,
    credentials: true,
  }),
)
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

// Cabecalhos de seguranca basicos (defense-in-depth).
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  next()
})

// ---------- Rotas publicas ----------

app.get('/health', async (_req: Request, res: Response) => {
  let database = 'ok'
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    database = 'unreachable'
  }

  res.json({
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    timestamp: new Date().toISOString(),
  })
})

// `express-rate-limit` estava instalado no projeto mas nunca aplicado: login,
// cadastro e recuperacao ficavam abertos a forca bruta. As rotas de auth sao as
// unicas nao autenticadas que aceitam POST, entao sao o alvo natural.
app.use('/api/auth', authLimiter, authRoutes)

// Cardapio publico e acompanhamento de pedido: sem login, escopado por slug.
app.use('/api/public', publicRoutes)

/**
 * Fotos de produto, servidas sem login.
 *
 * Publico de proposito: as mesmas imagens aparecem no cardapio publico, que nao
 * tem sessao. O nome do arquivo e sorteado (16 bytes), entao a URL nao pode ser
 * adivinhada nem enumerada a partir do id do produto.
 *
 * `contentType` fixado no `setHeaders` junto ao `nosniff` global: sem isso, um
 * arquivo cuja extensao nao case com o conteudo poderia ser interpretado como
 * HTML pelo navegador e executar script no nosso dominio. `index: false` e
 * `dotfiles: 'deny'` evitam listagem de pasta e arquivos ocultos.
 */
app.use(
  '/uploads',
  express.static(UPLOAD_ROOT, {
    index: false,
    dotfiles: 'deny',
    maxAge: '30d', // nome sorteado = arquivo imutavel: cache longo e seguro
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff')
    },
  }),
)

// ---------- Rotas protegidas ----------

// Negocios da conta e equipe. Ambas montam o proprio `authenticate` internamente
// (tenantRoutes) ou exigem owner (userRoutes).
app.use('/api/tenants', tenantRoutes)
app.use('/api/users', userRoutes)

// Cada area exige a permissao correspondente do catalogo. O guard no menu do
// frontend apenas esconde o item; e aqui que o acesso e efetivamente negado —
// sem isto, um funcionario poderia chamar a API direto pela URL.
// A permissao de LEITURA e exigida no mount; a de escrita fica dentro de cada
// rota, no verbo que altera dados.
// Envio de imagem. A permissao de escrita (`products:manage`) e cobrada dentro
// da rota, junto da validacao de tipo e tamanho.
app.use('/api/uploads', authenticate, uploadRoutes)

// Quem edita fichas tecnicas precisa escolher insumos mesmo quando o perfil nao
// recebeu acesso a tela completa de estoque.
app.use(
  '/api/ingredients',
  authenticate,
  requirePermission('ingredients:view', 'products:manage'),
  ingredientRoutes,
)
// `pdv:use` tambem libera a LEITURA de produtos, cardapio e clientes: quem opera
// o caixa precisa ver o que esta vendendo e buscar o cliente pelo telefone.
// Sem isso o PDV abria e falhava na hora de listar produtos ("Voce nao tem
// permissao"), deixando o caixa sem conseguir lancar uma unica venda — mesmo com
// `pdv:use` marcado. Continua sendo apenas leitura: criar/editar produto exige
// `products:manage` dentro da propria rota.
app.use('/api/products', authenticate, requirePermission('products:view', 'pdv:use'), productRoutes)
app.use('/api/menu', authenticate, requirePermission('products:view', 'pdv:use'), menuRoutes)
app.use('/api/orders', authenticate, requirePermission('orders:view', 'pdv:use'), orderRoutes)
// A API do KDS altera producao, prioridade e impressao. `orders:view` sozinho
// continua sendo leitura; somente quem recebeu acesso a cozinha opera esta fila.
app.use('/api/kitchen', authenticate, requirePermission('kitchen:view'), kitchenRoutes)
app.use('/api/deliveries', authenticate, requirePermission('delivery:manage'), deliveryRoutes)
app.use('/api/driver', authenticate, requirePermission('delivery:drive'), driverRoutes)
app.use('/api/purchases', authenticate, requirePermission('purchases:view', 'purchases:manage'), purchaseRoutes)
// O PDV chamava esta rota desde sempre, mas ela nao existia: 404 em toda busca
// por telefone, e todo cliente recorrente era cadastrado de novo.
app.use('/api/customers', authenticate, requirePermission('customers:view', 'pdv:use'), customerRoutes)
app.use('/api/invoices', authenticate, requirePermission('invoices:manage'), invoiceRoutes)
// O scanner CONSULTA com `scanner:use` (bipar um codigo e ver o que e), mas
// GRAVAR estoque exige `ingredients:manage` — aplicado dentro da propria rota
// de entrada. Sem essa separacao, qualquer um autorizado a conferir precos no
// balcao poderia alterar o saldo do deposito pelo celular.
app.use('/api/scanner', authenticate, requirePermission('scanner:use', 'ingredients:manage'), scannerRoutes)
app.use('/api/pricing', authenticate, requirePermission('pricing:view'), pricingRoutes)
// `/api/store` serve tanto leitura (o PDV le taxas e horario) quanto escrita
// (Ajustes), entao aqui exige apenas login: cada rota interna aplica o seu guard.
app.use('/api/store', authenticate, storeRoutes)
app.use('/api/financial', authenticate, requireFinancialAccess, financialRoutes)
app.use('/api/finance-center', authenticate, requirePermission('reports:view', 'payables:view', 'payables:manage', 'cash:close'), financeCenterRoutes)
/**
 * Painel de Visao geral. Exige `reports:view` OU `orders:view` — de proposito
 * mais frouxo que `/api/financial`, que passa pelo `requireFinancialAccess`.
 * Este painel mostra o dia da operacao (fila, canais, atrasos), nao o resultado
 * do negocio, e quem toca o turno precisa dele. O lucro que aparece aqui e
 * apenas o estimado do dia; DRE, CMV e LTV continuam atras do guard financeiro.
 */
app.use('/api/dashboard', authenticate, requirePermission('reports:view', 'orders:view'), dashboardRoutes)
// O caixa exige apenas LEITURA no mount (`cash:operate` ou `pdv:use`): o PDV
// precisa consultar se ha turno aberto antes de deixar vender, e quem so lanca
// venda nao tem `cash:operate`. Cada verbo que mexe em dinheiro aplica o guard
// proprio dentro da rota — abrir e suprimento pedem `cash:operate`, sangria e
// fechamento pedem `cash:close`.
app.use('/api/cash', authenticate, requirePermission('cash:operate', 'cash:close', 'pdv:use'), cashRoutes)
app.use('/api/payables', authenticate, requirePermission('payables:view', 'payables:manage'), payableRoutes)

// ---------- Tratamento de erros ----------
// A ordem importa: 404 para rota inexistente, depois o error handler.
app.use(notFoundHandler)
app.use(errorHandler)

const server = app.listen(env.PORT, () => {
  console.log(`[backend] ouvindo em http://localhost:${env.PORT} (${env.NODE_ENV})`)
})

// ---------- Tempo real (KDS e acompanhamento do pedido) ----------
const io = new SocketIOServer(server, {
  // Mesma regra do CORS do Express: sem isso o app abriria no celular e o
  // tempo real (KDS, acompanhamento do pedido) silenciosamente nao conectaria.
  cors: { origin: corsOriginCheck, credentials: true },
})

// Cada socket precisa provar quem e antes de entrar na sala da loja,
// senao um cliente poderia escutar os pedidos de outro restaurante.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined
  if (!token) return next(new Error('Token nao fornecido'))
  try {
    const auth = verifyToken(token)
    socket.data.auth = auth
    void socket.join(tenantRoom(auth.tenantId))
    next()
  } catch {
    next(new Error('Token invalido'))
  }
})

setRealtimeServer(io)

// ---------- Encerramento gracioso ----------
async function shutdown(signal: string) {
  console.log(`[backend] recebido ${signal}, encerrando...`)
  server.close(() => console.log('[backend] servidor HTTP fechado'))
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

export { app }
