/**
 * Teste de seguranca das rotas de precificacao.
 *
 * Prova que a falha de "mass assignment" esta fechada: enviar `tenantId` (ou
 * qualquer campo controlado pelo servidor) no corpo do request nao altera o
 * registro nem transfere dados para outra loja.
 *
 * NUNCA rode isto contra o banco de producao: o teste cria uma segunda empresa
 * e tenta invadi-la de proposito. Aponte DATABASE_URL e API_URL para o
 * ambiente de teste.
 *
 *   DATABASE_URL=postgresql://...banco_de_teste \
 *   API_URL=http://localhost:3002 \
 *   node scripts/test-security.mjs
 */
import { PrismaClient } from '@prisma/client'

const API = process.env.API_URL ?? 'http://localhost:3002'
const EMAIL = process.env.TEST_EMAIL ?? 'admin@local'
const PASSWORD = process.env.TEST_PASSWORD ?? 'admin123'

const prisma = new PrismaClient()

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log(`  PASSOU  ${name}`)
  } else {
    failed++
    console.log(`  FALHOU  ${name}${detail ? ` -> ${detail}` : ''}`)
  }
}

function guardProductionDatabase() {
  const url = process.env.DATABASE_URL ?? ''
  const looksLikeTest = /localhost|127\.0\.0\.1|test/i.test(url)
  if (!looksLikeTest) {
    console.error('ABORTADO: DATABASE_URL nao parece ser de teste.')
    console.error('Este script cria uma empresa falsa e tenta invadi-la.')
    console.error('Use um banco local ou uma branch da Neon, nunca o banco real.')
    process.exit(1)
  }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* resposta sem corpo */
  }
  return { status: res.status, json }
}

async function login() {
  const { status, json } = await api('POST', '/api/auth/login', {
    body: { email: EMAIL, password: PASSWORD },
  })
  const token = json?.token ?? json?.accessToken ?? json?.data?.token
  if (status !== 200 || !token) {
    throw new Error(`login falhou (HTTP ${status}): ${JSON.stringify(json)?.slice(0, 200)}`)
  }
  return token
}

async function main() {
  guardProductionDatabase()
  console.log(`API: ${API}`)

  const token = await login()

  const myTenant = await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } })

  // Segunda empresa, usada como alvo das tentativas de invasao.
  const rival = await prisma.tenant.upsert({
    where: { slug: 'rival-teste-seguranca' },
    update: {},
    create: {
      name: 'Rival Teste',
      slug: 'rival-teste-seguranca',
      email: 'rival@teste.local',
    },
  })
  const rivalChannel = await prisma.salesChannel.upsert({
    where: { id: 'canal-rival-teste' },
    update: { tenantId: rival.id },
    create: { id: 'canal-rival-teste', name: 'Canal do Rival', slug: 'rival', tenantId: rival.id },
  })

  const myChannel = await prisma.salesChannel.findFirst({ where: { tenantId: myTenant.id } })
  if (!myChannel) throw new Error('a loja de teste nao tem canal de venda; rode o seed antes')

  console.log('\n1) INJECAO DE CAMPO — tenantId no corpo do request')

  // Antes da correcao esta chamada respondia 200 e transferia o canal.
  let r = await api('PUT', `/api/pricing/channels/${myChannel.id}`, {
    token,
    body: { tenantId: rival.id },
  })
  check('PUT canal com so tenantId e recusado (400)', r.status === 400, `HTTP ${r.status}`)

  let after = await prisma.salesChannel.findUnique({ where: { id: myChannel.id } })
  check('canal continua na minha loja', after.tenantId === myTenant.id, `tenantId=${after.tenantId}`)

  // Campo valido junto do proibido: o valido aplica, o proibido e descartado.
  r = await api('PUT', `/api/pricing/channels/${myChannel.id}`, {
    token,
    body: { targetMarginPerc: 33, tenantId: rival.id, id: 'id-forjado', createdAt: '2020-01-01' },
  })
  check('PUT com campo valido + proibidos responde 200', r.status === 200, `HTTP ${r.status}`)

  after = await prisma.salesChannel.findUnique({ where: { id: myChannel.id } })
  check('tenantId ignorado (canal nao mudou de loja)', after.tenantId === myTenant.id)
  check('id ignorado (registro preservado)', after.id === myChannel.id)
  check('campo legitimo aplicado (margem = 33)', Number(after.targetMarginPerc) === 33)

  console.log('\n2) CRIACAO — tenantId forjado no POST')

  const slug = `teste-seg-${Date.now()}`
  r = await api('POST', '/api/pricing/channels', {
    token,
    body: { name: 'Canal de Teste', slug, tenantId: rival.id },
  })
  check('POST canal responde 201', r.status === 201, `HTTP ${r.status}`)
  const createdId = r.json?.data?.id
  if (createdId) {
    const created = await prisma.salesChannel.findUnique({ where: { id: createdId } })
    check('canal criado na MINHA loja, nao na do rival', created.tenantId === myTenant.id)
    await prisma.salesChannel.delete({ where: { id: createdId } })
  }

  console.log('\n3) ISOLAMENTO — alterar registro de outra empresa')

  r = await api('PUT', `/api/pricing/channels/${rivalChannel.id}`, {
    token,
    body: { name: 'INVADIDO' },
  })
  check('PUT em canal de outra loja retorna 404', r.status === 404, `HTTP ${r.status}`)

  const rivalAfter = await prisma.salesChannel.findUnique({ where: { id: rivalChannel.id } })
  check('nome do canal do rival intacto', rivalAfter.name === 'Canal do Rival', rivalAfter.name)

  console.log('\n4) VALIDACAO DE TIPO E FAIXA')

  r = await api('PUT', `/api/pricing/channels/${myChannel.id}`, {
    token,
    body: { slug: 'MAIUSCULA COM ESPACO' },
  })
  check('slug invalido recusado (400)', r.status === 400, `HTTP ${r.status}`)

  r = await api('PUT', `/api/pricing/channels/${myChannel.id}`, {
    token,
    body: { platformFeePerc: 5000 },
  })
  check('taxa acima de 100% recusada (400)', r.status === 400, `HTTP ${r.status}`)

  r = await api('PUT', `/api/pricing/channels/${myChannel.id}`, {
    token,
    body: { targetMarginPerc: 'muito' },
  })
  check('margem nao numerica recusada (400)', r.status === 400, `HTTP ${r.status}`)

  const rule = await prisma.pricingRule.findFirst({ where: { tenantId: myTenant.id } })
  if (rule) {
    r = await api('PUT', `/api/pricing/rule/${rule.id}/price`, { token, body: { finalPrice: 0 } })
    check('preco final zero recusado (evita divisao por zero)', r.status === 400, `HTTP ${r.status}`)
  } else {
    console.log('  (sem regra de preco no banco; teste de preco zero ignorado)')
  }

  console.log('\n5) FROTA — mesmo padrao de injecao')

  const fleet = await prisma.fleet.create({
    data: { name: 'Moto de Teste', tenantId: myTenant.id },
  })
  r = await api('PUT', `/api/pricing/fleet/${fleet.id}`, {
    token,
    body: { deliveryFee: 7, tenantId: rival.id },
  })
  check('PUT frota responde 200', r.status === 200, `HTTP ${r.status}`)
  const fleetAfter = await prisma.fleet.findUnique({ where: { id: fleet.id } })
  check('frota continua na minha loja', fleetAfter.tenantId === myTenant.id)
  check('taxa de entrega aplicada (7)', Number(fleetAfter.deliveryFee) === 7)
  await prisma.fleet.delete({ where: { id: fleet.id } })

  // Limpeza da empresa usada nos ataques.
  await prisma.salesChannel.deleteMany({ where: { tenantId: rival.id } })
  await prisma.tenant.delete({ where: { id: rival.id } })

  console.log(`\nRESULTADO: ${passed} passaram, ${failed} falharam`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error('ERRO NO TESTE:', err.message)
  await prisma.$disconnect()
  process.exit(1)
})
