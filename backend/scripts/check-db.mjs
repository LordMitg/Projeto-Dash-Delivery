/**
 * Confere a conexao com o banco ANTES de qualquer comando do Prisma.
 *
 * Motivo de existir: o Prisma falha com mensagens que nao ajudam quem so quer
 * usar o sistema ("P1001: Can't reach database server", "Environment variable
 * not found"). Este script testa a conexao em etapas (arquivo -> texto da URL ->
 * DNS -> porta -> login) e diz, em portugues, qual etapa quebrou e o que fazer.
 *
 * Rodar: pnpm --filter delivery-erp-backend db:check
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dns from 'node:dns/promises'
import net from 'node:net'

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(backendDir, '.env')

/** Fim da execucao com uma mensagem emoldurada, para nao se perder no terminal. */
function falhar(titulo, linhas) {
  console.error('')
  console.error('  ' + '-'.repeat(66))
  console.error('  ' + titulo)
  console.error('  ' + '-'.repeat(66))
  for (const linha of linhas) console.error('  ' + linha)
  console.error('')
  process.exit(1)
}

function ok(mensagem) {
  console.log('  [ok] ' + mensagem)
}

/**
 * Le o .env sem depender do dotenv.
 *
 * O valor NAO passa por trim de aspas simples porque a senha do Neon pode conter
 * caracteres que viram lixo se tratados como delimitador. Aspas duplas em volta
 * do valor inteiro sao removidas, que e o formato que o proprio Prisma aceita.
 */
function lerEnv(caminho) {
  const texto = readFileSync(caminho, 'utf8')
  const valores = {}
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim()
    if (!limpa || limpa.startsWith('#')) continue
    const igual = limpa.indexOf('=')
    if (igual === -1) continue
    const chave = limpa.slice(0, igual).trim()
    let valor = limpa.slice(igual + 1).trim()
    if (valor.startsWith('"') && valor.endsWith('"')) valor = valor.slice(1, -1)
    valores[chave] = valor
  }
  return valores
}

console.log('')
console.log('  Conferindo o banco de dados...')

// ---------------------------------------------------------------------------
// 1. O arquivo de configuracao existe?
// ---------------------------------------------------------------------------
if (!existsSync(envPath)) {
  falhar('O arquivo de configuracao nao existe.', [
    'Falta o arquivo: backend\\.env',
    '',
    'Feche esta janela e abra o iniciar_sistema.bat de novo:',
    'ele cria o arquivo automaticamente na primeira execucao.',
  ])
}
ok('arquivo backend\\.env encontrado')

const env = lerEnv(envPath)
const url = env.DATABASE_URL

// ---------------------------------------------------------------------------
// 2. A linha de conexao foi preenchida?
//
// O .env.example vem com um endereco de exemplo. Se ele continuar ali, o erro
// do Prisma seria sobre DNS, escondendo a causa real: ninguem colou a string.
// ---------------------------------------------------------------------------
if (!url) {
  falhar('Falta o endereco do banco (DATABASE_URL).', [
    'Abra o arquivo backend\\.env e preencha a linha DATABASE_URL',
    'com o endereco de conexao do Neon.',
  ])
}

if (url.includes('SUA_STRING_DO_NEON') || url.includes('COLE_AQUI')) {
  falhar('O endereco do banco ainda e o texto de exemplo.', [
    'Abra o arquivo backend\\.env e troque a linha DATABASE_URL',
    'pelo endereco que o Neon mostrou (o botao "Connect" do painel).',
    '',
    'O endereco correto se parece com isto:',
    'postgresql://usuario:senha@ep-algo-123.sa-east-1.aws.neon.tech/neondb?sslmode=require',
  ])
}

// ---------------------------------------------------------------------------
// 3. O texto da URL faz sentido?
// ---------------------------------------------------------------------------
let conexao
try {
  conexao = new URL(url)
} catch {
  falhar('O endereco do banco esta com a escrita errada.', [
    'O valor de DATABASE_URL nao e um endereco valido.',
    '',
    'Ele precisa comecar com postgresql:// e ficar em UMA SO LINHA,',
    'sem espacos e sem aspas em volta.',
  ])
}

if (!/^postgres(ql)?:$/.test(conexao.protocol)) {
  falhar('O endereco do banco nao e do PostgreSQL.', [
    `Ele comeca com "${conexao.protocol}" e deveria comecar com "postgresql://".`,
  ])
}

const host = conexao.hostname
const porta = Number(conexao.port || 5432)
const banco = conexao.pathname.replace(/^\//, '')
const usuario = decodeURIComponent(conexao.username || '')

if (!host) falhar('O endereco do banco nao tem servidor.', ['Falta a parte depois do @ na DATABASE_URL.'])
if (!usuario) falhar('O endereco do banco nao tem usuario.', ['Falta a parte entre // e : na DATABASE_URL.'])
if (!conexao.password) {
  falhar('O endereco do banco nao tem senha.', [
    'No Neon a senha vem junto do endereco. Copie a string completa',
    'do painel (opcao que mostra a senha) e cole no backend\\.env.',
  ])
}
if (!banco) {
  falhar('O endereco do banco nao diz qual banco usar.', [
    'Falta o nome do banco no fim do endereco (no Neon, normalmente /neondb).',
  ])
}

const naNuvem = /neon\.tech|aws|azure|render|supabase|railway/i.test(host)
ok(`endereco valido (servidor ${host}, banco ${banco})`)

/**
 * Neon exige SSL. Sem `sslmode=require` a conexao e recusada com uma mensagem
 * generica de servidor inalcancavel, que aponta para o lugar errado.
 */
if (naNuvem && !/sslmode=/i.test(conexao.search)) {
  falhar('Falta o SSL no endereco do banco.', [
    'Bancos na nuvem (como o Neon) so aceitam conexao criptografada.',
    '',
    'Acrescente no FIM da linha DATABASE_URL, dentro do backend\\.env:',
    '  ?sslmode=require',
    '',
    'Se o endereco ja tiver um "?", use "&sslmode=require" no lugar.',
  ])
}

/**
 * A string "-pooler" e a conexao agrupada do Neon. Ela serve para uso normal,
 * mas o `prisma migrate` precisa de sessao propria e pode travar nela. O aviso
 * fica aqui porque migrar e justamente o proximo passo do iniciar_sistema.bat.
 */
if (/-pooler\./.test(host)) {
  console.log('  [aviso] este e o endereco "pooler" do Neon.')
  console.log('          Se a criacao das tabelas travar, troque no backend\\.env')
  console.log('          para o endereco sem "-pooler" (opcao "Direct connection").')
}

// ---------------------------------------------------------------------------
// 4. O servidor existe na internet? (DNS)
// ---------------------------------------------------------------------------
/** `localhost`/127.0.0.1 nao ficam "na internet": dizer isso confundiria. */
const ehLocal = host === 'localhost' || /^127\./.test(host) || host === '::1'

try {
  await dns.lookup(host)
  ok(ehLocal ? 'servidor local encontrado' : 'servidor localizado na internet')
} catch (erro) {
  const semRede = erro.code === 'ENOTFOUND' || erro.code === 'EAI_AGAIN'
  falhar('Nao foi possivel encontrar o servidor do banco.', [
    `Servidor procurado: ${host}`,
    `Detalhe tecnico: ${erro.code || erro.message}`,
    '',
    ...(semRede
      ? [
          'As duas causas possiveis:',
          '  1. O computador esta sem internet. O banco fica na nuvem,',
          '     entao o sistema precisa de conexao para funcionar.',
          '  2. O endereco em backend\\.env tem um erro de digitacao.',
        ]
      : ['Verifique sua conexao com a internet e o endereco em backend\\.env.']),
  ])
}

// ---------------------------------------------------------------------------
// 5. A porta responde? (firewall / antivirus costumam barrar aqui)
// ---------------------------------------------------------------------------
/**
 * Tenta abrir a porta uma vez. Devolve `null` quando conseguiu, ou o motivo
 * da falha ('timeout' ou o codigo do erro) quando nao conseguiu.
 *
 * O servidor do Neon hiberna quando ninguem usa. A primeira tentativa do dia
 * costuma demorar mais porque ele precisa acordar, por isso o tempo de espera
 * aqui e generoso e a chamada e repetida algumas vezes antes de desistir.
 */
function tentarPorta(alvo, portaAlvo, esperaMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: alvo, port: portaAlvo })
    const encerrar = () => {
      socket.removeAllListeners()
      socket.destroy()
    }
    socket.setTimeout(esperaMs)
    socket.on('connect', () => {
      encerrar()
      resolve(null)
    })
    socket.on('timeout', () => {
      encerrar()
      resolve('timeout')
    })
    socket.on('error', (erro) => {
      encerrar()
      resolve(erro.code || erro.message)
    })
  })
}

let motivoPorta = null

for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
  motivoPorta = await tentarPorta(host, porta, 25000)

  if (motivoPorta === null) {
    ok(`porta ${porta} respondeu`)
    break
  }

  // Porta recusada nao melhora com repeticao: e endereco ou porta errada.
  if (motivoPorta !== 'timeout') break

  if (tentativa < 3) {
    console.log(
      `  [aviso] sem resposta na tentativa ${tentativa} de 3; o servidor pode estar acordando, aguarde...`,
    )
  }
}

if (motivoPorta !== null) {
  // O endereco "pooler" as vezes e barrado onde o direto passa (e vice-versa).
  // Vale testar o outro antes de culpar o firewall, porque a solucao muda.
  const alternativo = host.includes('-pooler')
    ? host.replace('-pooler', '')
    : host.replace(/^([^.]+)\./, '$1-pooler.')

  const motivoAlternativo = await tentarPorta(alternativo, porta, 25000)

  if (motivoAlternativo === null) {
    falhar('O endereco do banco que esta no arquivo nao responde, mas o outro responde.', [
      `Nao respondeu: ${host}`,
      `Respondeu:     ${alternativo}`,
      '',
      'Para resolver, abra o arquivo backend\\.env e troque o servidor',
      'que esta na linha DATABASE_URL por este que respondeu:',
      '',
      `   ${alternativo}`,
      '',
      'O resto da linha (usuario, senha, banco) continua igual.',
    ])
  }

  if (motivoPorta === 'timeout') {
    falhar('O servidor do banco nao respondeu no tempo esperado.', [
      `Servidor: ${host}  porta: ${porta}`,
      '',
      'Foram 3 tentativas, e o endereco alternativo tambem nao respondeu.',
      'Isso quase sempre e algo no seu computador ou na sua rede barrando a saida.',
      '',
      'Tente nesta ordem:',
      '  1. Desligue o antivirus por alguns minutos e rode este arquivo de novo',
      '     (o Kaspersky, o Avast e o AVG bloqueiam a porta 5432 por padrao).',
      '  2. No Windows Defender, libere a saida na porta 5432.',
      '  3. Se estiver no Wi-Fi de uma empresa, escola ou orgao publico,',
      '     troque para a internet do celular para confirmar que e a rede.',
      '  4. Confira no painel do Neon (neon.tech) se o projeto continua ativo:',
      '     projetos gratuitos sem uso por muito tempo sao removidos.',
    ])
  }

  falhar('A conexao com o servidor do banco foi recusada.', [
    `Servidor: ${host}  porta: ${porta}`,
    `Detalhe tecnico: ${motivoPorta}`,
    '',
    'Confira se a porta no endereco esta correta.',
    'No Neon a porta e 5432 (e costuma vir junto do endereco).',
  ])
}

// ---------------------------------------------------------------------------
// 6. O usuario e a senha estao certos? (so aqui o Prisma entra)
// ---------------------------------------------------------------------------
let PrismaClient
try {
  const modulo = await import('@prisma/client')
  PrismaClient = modulo.PrismaClient ?? modulo.default?.PrismaClient
} catch {
  // Sem cliente gerado nao da para testar o login, mas as etapas acima ja
  // passaram: o mais util e deixar o fluxo seguir para o `prisma generate`.
  console.log('  [aviso] cliente do Prisma ainda nao foi gerado; login nao testado.')
  process.exit(0)
}

const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] })
try {
  await prisma.$queryRaw`SELECT 1`
  ok('usuario e senha aceitos')
  console.log('')
  console.log('  Banco de dados acessivel.')
  console.log('')
} catch (erro) {
  const texto = String(erro.message || '')
  const codigo = erro.code || ''

  if (codigo === 'P1000' || /authentication failed|28P01/i.test(texto)) {
    falhar('A senha do banco foi recusada.', [
      `Usuario usado: ${usuario}`,
      '',
      'Copie novamente a string de conexao no painel do Neon',
      '(marque a opcao que mostra a senha) e cole no backend\\.env.',
      '',
      'Atencao: se a senha tiver @ : / ? # ela precisa ser escapada.',
      'O mais simples e gerar uma senha nova no Neon (Reset password).',
    ])
  }
  if (codigo === 'P1003' || /does not exist|3D000/i.test(texto)) {
    falhar('O banco indicado no endereco nao existe.', [
      `Banco procurado: ${banco}`,
      '',
      'No Neon o banco padrao chama neondb. Confira o nome no fim',
      'do endereco em backend\\.env.',
    ])
  }

  /**
   * "Can't reach database server" APESAR de DNS e porta terem respondido.
   *
   * E o caso do endereco com o nome do servidor errado: o Neon resolve
   * qualquer subdominio *.neon.tech para o gateway deles, que aceita a conexao
   * TCP e so entao recusa o projeto inexistente. Sem este ramo o script caia na
   * mensagem genErica do fim, que saia vazia -- o Prisma deixa `code` como
   * `undefined` e a PRIMEIRA linha da mensagem em branco.
   */
  if (codigo === 'P1001' || /can't reach database server/i.test(texto)) {
    falhar('O servidor respondeu, mas recusou este banco.', [
      `Endereco tentado: ${host}`,
      '',
      'O endereco existe, porem o Neon nao reconheceu este projeto.',
      'Quase sempre e um erro de copia: falta um pedaco do nome do',
      'servidor, ou ele e de um projeto que foi apagado.',
      '',
      'Copie a string outra vez no botao "Connect" do painel do Neon',
      'e cole inteira no backend\\.env.',
    ])
  }

  /**
   * O fallback usa a primeira linha NAO vazia: erros de inicializacao do Prisma
   * comecam com linha em branco, e `split('\n')[0]` mostrava nada.
   */
  const primeiraLinhaUtil =
    texto
      .split('\n')
      .map((linha) => linha.trim())
      .find((linha) => linha && !linha.startsWith('Invalid `prisma.')) ?? 'sem detalhe'

  falhar('Nao foi possivel entrar no banco de dados.', [
    primeiraLinhaUtil,
    '',
    `Detalhe tecnico: ${codigo || erro.constructor?.name || 'desconhecido'}`,
  ])
} finally {
  await prisma.$disconnect().catch(() => {})
}
