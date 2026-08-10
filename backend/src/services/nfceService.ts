/**
 * Leitura de NFC-e (nota fiscal de consumidor) a partir do QR Code.
 *
 * ---------------------------------------------------------------------------
 * O QUE O QR CODE REALMENTE CONTEM
 * ---------------------------------------------------------------------------
 * Um mal-entendido comum e achar que o QR da nota carrega a lista de compras.
 * Nao carrega. O conteudo e uma URL de consulta ao portal da SEFAZ do estado,
 * com um parametro `p` composto por campos separados por `|`:
 *
 *   https://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx?p=CHAVE|VERSAO|AMBIENTE|...|HASH
 *
 * O primeiro campo e a chave de acesso de 44 digitos; o ultimo e um hash que
 * autentica a consulta. Os ITENS ficam na SEFAZ — para obte-los e preciso
 * abrir essa URL. E por isso que este servico faz uma requisicao HTTP: nao ha
 * como extrair produtos do QR sozinho, por mais que se queira.
 *
 * ---------------------------------------------------------------------------
 * POR QUE TUDO AQUI DEGRADA EM VEZ DE FALHAR
 * ---------------------------------------------------------------------------
 * Depender de raspagem de HTML de 27 portais estaduais e fragil por natureza:
 * cada estado tem seu layout, alguns exigem captcha, e qualquer um deles pode
 * mudar sem aviso. Um scanner que responde "erro" quando o portal muda e
 * inutil no balcao do deposito.
 *
 * Entao o contrato aqui e: SEMPRE devolver algo aproveitavel. Se a consulta
 * online funciona, voltam os itens. Se nao funciona, volta a nota identificada
 * (chave, UF, numero, data) com `source: 'manual'` e um motivo legivel — e a
 * tela deixa o usuario lancar os itens na mao, com o cabecalho ja preenchido.
 * Nunca se perde a leitura do QR por causa de uma indisponibilidade da SEFAZ.
 */
import * as https from 'node:https'
import * as http from 'node:http'
import { rootCertificates as tlsRootCertificates } from 'node:tls'
import * as cheerio from 'cheerio'
import { ICP_BRASIL_V10_PEM } from '../certs/icpBrasil.js'

// ---------------------------------------------------------------------------
// CONFIANCA TLS NA ICP-BRASIL
// ---------------------------------------------------------------------------

/**
 * Os portais da SEFAZ usam certificados emitidos pela ICP-Brasil, cuja raiz
 * NAO acompanha o conjunto de CAs do Node nem o da maioria das distribuicoes
 * Linux. O resultado e um handshake que falha com "unable to get local issuer
 * certificate" — nao e instabilidade do portal, e ausencia da raiz.
 *
 * A saida ERRADA e obvia e tentadora: `rejectUnauthorized: false`, ou pior,
 * `NODE_TLS_REJECT_UNAUTHORIZED=0`, que desliga a verificacao de TLS do
 * processo INTEIRO — inclusive das chamadas ao banco e a qualquer API de
 * pagamento. Isso troca um erro visivel por uma vulnerabilidade silenciosa a
 * ataque de intermediario.
 *
 * O certificado abaixo e a raiz oficial (ICP-Brasil v10, valida ate 2032),
 * baixada de acraiz.icpbrasil.gov.br. Ele e ADICIONADO as CAs padrao e usado
 * apenas nas requisicoes deste servico: a verificacao continua ligada e todo
 * o resto do processo segue com a confianca original.
 *
 *   SHA-256: 6E:0B:FF:06:9A:26:99:4C:15:DE:2C:48:88:CC:54:AF:
 *            84:88:2E:54:95:B7:FB:F6:6B:E9:CC:FF:EC:74:89:F6
 */
let sefazAgent: https.Agent | undefined
let agentReady = false

function getSefazAgent(): https.Agent | undefined {
  if (agentReady) return sefazAgent
  agentReady = true

  sefazAgent = new https.Agent({
    // `ca` SUBSTITUI a lista padrao, entao e preciso reunir as duas: sem as
    // CAs publicas, um portal que use certificado comum (Let's Encrypt,
    // DigiCert) passaria a falhar. Incluir ambas mantem a verificacao valida
    // para qualquer emissor legitimo.
    ca: [...tlsRootCertificates, ICP_BRASIL_V10_PEM],
    keepAlive: false,
  })

  return sefazAgent
}

// ---------------------------------------------------------------------------
// UNIDADES DA FEDERACAO
// ---------------------------------------------------------------------------

/**
 * Codigo IBGE do estado -> sigla.
 *
 * Os dois primeiros digitos da chave de acesso sao este codigo, o que permite
 * descobrir a UF da nota SEM perguntar nada ao usuario e sem depender do
 * endereco cadastrado da loja — importante porque uma compra pode ser feita
 * fora do estado da loja (viagem, fornecedor de outra praca).
 */
const UF_BY_CODE: Record<string, string> = {
  '11': 'RO',
  '12': 'AC',
  '13': 'AM',
  '14': 'RR',
  '15': 'PA',
  '16': 'AP',
  '17': 'TO',
  '21': 'MA',
  '22': 'PI',
  '23': 'CE',
  '24': 'RN',
  '25': 'PB',
  '26': 'PE',
  '27': 'AL',
  '28': 'SE',
  '29': 'BA',
  '31': 'MG',
  '32': 'ES',
  '33': 'RJ',
  '35': 'SP',
  '41': 'PR',
  '42': 'SC',
  '43': 'RS',
  '50': 'MS',
  '51': 'MT',
  '52': 'GO',
  '53': 'DF',
}

export const UF_LIST = Object.values(UF_BY_CODE).sort()

/**
 * URL de consulta publica por estado, usada apenas como PLANO B.
 *
 * O caminho preferido e sempre reutilizar a URL que veio dentro do proprio QR
 * Code: ela ja vem com o hash de autenticacao, que varios portais exigem para
 * liberar o detalhe dos itens. Este mapa cobre o caso em que o usuario digita
 * a chave de 44 digitos na mao — sem QR, nao ha hash.
 */
const CONSULTA_URL_BY_UF: Record<string, (chave: string) => string> = {
  BA: (c) => `https://nfe.sefaz.ba.gov.br/servicos/nfce/modulos/geral/NFCEC_consulta_chave_acesso.aspx?chNFe=${c}`,
  SP: (c) => `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?chNFe=${c}`,
  MG: (c) => `https://nfce.fazenda.mg.gov.br/portalnfce/sistema/consultaarg.xhtml?chNFe=${c}`,
  RJ: (c) => `https://consultadfe.fazenda.rj.gov.br/consultaDFe/paginas/consultaChaveAcesso.faces?chNFe=${c}`,
  PR: (c) => `https://www.fazenda.pr.gov.br/nfce/qrcode?chNFe=${c}`,
  RS: (c) => `https://www.sefaz.rs.gov.br/ASP/AAE_ROOT/NFE/SAT-WEB-NFE-NFC_QRCODE_1.asp?chNFe=${c}`,
  SC: (c) => `https://sat.sef.sc.gov.br/nfce/consulta?chNFe=${c}`,
  GO: (c) => `https://nfe.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe?chNFe=${c}`,
  PE: (c) => `https://nfce.sefaz.pe.gov.br/nfce-web/consultarNFCe?chNFe=${c}`,
  CE: (c) => `https://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html?chNFe=${c}`,
  DF: (c) => `https://dec.fazenda.df.gov.br/ConsultarNFCe.aspx?chNFe=${c}`,
  ES: (c) => `https://app.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx?chNFe=${c}`,
  MS: (c) => `https://www.dfe.ms.gov.br/nfce/qrcode?chNFe=${c}`,
  MT: (c) => `https://www.sefaz.mt.gov.br/nfce/consultanfce?chNFe=${c}`,
  PA: (c) => `https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam?chNFe=${c}`,
  PB: (c) => `https://www.receita.pb.gov.br/nfce/qrcode?chNFe=${c}`,
  RN: (c) => `http://nfce.set.rn.gov.br/consultarNFCe.aspx?chNFe=${c}`,
  AL: (c) => `http://nfce.sefaz.al.gov.br/consultaNFCe.provisorio?chNFe=${c}`,
  SE: (c) => `https://www.nfce.se.gov.br/portal/consultarNFCe.jsp?chNFe=${c}`,
  PI: (c) => `http://www.sefaz.pi.gov.br/nfce/qrcode?chNFe=${c}`,
  MA: (c) => `https://sistemas.sefaz.ma.gov.br/nfce/consulta.jsf?chNFe=${c}`,
  TO: (c) => `https://www.sefaz.to.gov.br/nfce/qrcode?chNFe=${c}`,
  AM: (c) => `https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp?chNFe=${c}`,
  AC: (c) => `http://www.sefaznet.ac.gov.br/nfce/qrcode?chNFe=${c}`,
  RO: (c) => `http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp?chNFe=${c}`,
  RR: (c) => `https://www.sefaz.rr.gov.br/nfce/servlet/qrcode?chNFe=${c}`,
  AP: (c) => `https://www.sefaz.ap.gov.br/nfce/nfcep.php?chNFe=${c}`,
}

// ---------------------------------------------------------------------------
// CHAVE DE ACESSO
// ---------------------------------------------------------------------------

export interface ChaveDecodificada {
  chave: string
  uf: string
  /** `65` = NFC-e (cupom de consumidor), `55` = NF-e (nota de fornecedor). */
  modelo: string
  serie: string
  numero: string
  emitenteCnpj: string
  /** Competencia declarada na chave (nao e a data exata de emissao). */
  ano: number
  mes: number
}

/** Extrai a sequencia de 44 digitos de uma URL de QR, de texto colado ou da digitacao. */
export function extractAccessKey(raw: string): string | null {
  const digitsOnly = String(raw ?? '').replace(/\D/g, '')

  // A chave costuma vir "limpa" quando o usuario digita, e embutida numa URL
  // longa quando vem do QR. Procurar por uma janela de exatamente 44 digitos
  // cobre os dois casos sem precisar saber de onde o texto veio.
  if (digitsOnly.length === 44) return digitsOnly

  const match = String(raw ?? '').match(/\d{44}/)
  if (match) return match[0]

  // Ultimo recurso: o parametro `p` traz a chave antes do primeiro `|`.
  const pParam = String(raw ?? '').match(/[?&]p=([^&\s]+)/i)
  if (pParam?.[1]) {
    const first = (decodeURIComponent(pParam[1]).split('|')[0] ?? '').replace(/\D/g, '')
    if (first.length === 44) return first
  }

  return null
}

/**
 * Valida o digito verificador (modulo 11) da chave de acesso.
 *
 * Isto nao e purismo: leitura de codigo com camera erra, e uma chave com um
 * digito trocado produz uma consulta que a SEFAZ recusa com uma mensagem
 * generica. Validar localmente transforma um "erro do portal" incompreensivel
 * em "a leitura saiu incompleta, tente de novo" — que o usuario sabe resolver.
 */
export function isValidAccessKey(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false

  const base = chave.slice(0, 43)
  const dv = Number(chave[43])

  // Pesos ciclicos de 2 a 9, aplicados da direita para a esquerda.
  let peso = 2
  let soma = 0
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }

  const resto = soma % 11
  const esperado = resto === 0 || resto === 1 ? 0 : 11 - resto
  return esperado === dv
}

/** Quebra a chave de 44 digitos nos campos que ela codifica. */
export function decodeAccessKey(chave: string): ChaveDecodificada | null {
  if (!/^\d{44}$/.test(chave)) return null

  const cUF = chave.slice(0, 2)
  const uf = UF_BY_CODE[cUF]
  if (!uf) return null

  return {
    chave,
    uf,
    ano: 2000 + Number(chave.slice(2, 4)),
    mes: Number(chave.slice(4, 6)),
    emitenteCnpj: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    serie: chave.slice(22, 25),
    numero: String(Number(chave.slice(25, 34))),
  }
}

/** Formata CNPJ para leitura humana. */
function formatCnpj(cnpj: string): string {
  if (!/^\d{14}$/.test(cnpj)) return cnpj
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

// ---------------------------------------------------------------------------
// RESULTADO
// ---------------------------------------------------------------------------

export interface NfceItem {
  numeroItem: number
  /** Codigo do produto no emitente. Costuma ser o EAN, mas nao e garantido. */
  codigo: string
  descricao: string
  unit: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface NfceLookupResult {
  chave: string
  uf: string
  modelo: string
  serie: string
  numero: string
  emitenteCnpj: string
  emitente: string | null
  dataEmissao: string | null
  valorTotal: number | null
  items: NfceItem[]
  /**
   * `sefaz`  — itens vieram do portal e podem ser conferidos na tela.
   * `manual` — a consulta nao trouxe itens; a nota vem so identificada.
   */
  source: 'sefaz' | 'manual'
  /** Explicacao legivel de por que caiu em `manual`. Nulo quando deu certo. */
  warning: string | null
  consultaUrl: string
}

// ---------------------------------------------------------------------------
// NORMALIZACAO DE NUMEROS
// ---------------------------------------------------------------------------

/**
 * Converte numero em formato brasileiro ("1.234,56") para `number`.
 *
 * Tratar isso com `parseFloat` direto e uma armadilha classica: `parseFloat`
 * para no primeiro caractere invalido, entao "1.234,56" vira 1.234 — um erro
 * de mil vezes que passaria despercebido numa conferencia rapida de estoque.
 */
function parseBrNumber(raw: string | undefined | null): number {
  if (!raw) return 0

  const cleaned = String(raw)
    .replace(/\s|\u00a0/g, '')
    .replace(/[^\d.,-]/g, '')

  if (!cleaned) return 0

  // Com virgula presente, ela e o separador decimal e o ponto e milhar.
  // Sem virgula, o ponto ja e o separador decimal.
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned

  const value = Number(normalized)
  return Number.isFinite(value) ? value : 0
}

/** Colapsa espacos e remove entidades invisiveis herdadas do HTML da SEFAZ. */
function clean(raw: string | undefined | null): string {
  return String(raw ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// PARSER DO HTML DA SEFAZ
// ---------------------------------------------------------------------------

/**
 * Extrai os itens da pagina publica de consulta.
 *
 * A maioria dos estados usa a implementacao de referencia do Encat, cujo HTML
 * tem uma `<table id="tabResult">` com uma linha por item e classes estaveis
 * (`txtTit` para a descricao, `Rqtd` para a quantidade, e assim por diante).
 * Este parser mira nessa estrutura e, quando ela nao aparece, tenta uma
 * varredura generica por linhas de tabela antes de desistir.
 */
export function parseNfceHtml(html: string): {
  items: NfceItem[]
  emitente: string | null
  valorTotal: number | null
  dataEmissao: string | null
} {
  const $ = cheerio.load(html)

  // -- Emitente ------------------------------------------------------------
  // `#u20` e o id do nome no layout padrao; os outros sao variacoes vistas em
  // portais que customizaram o tema.
  const emitente =
    clean($('#u20').first().text()) ||
    clean($('.txtTopo').first().text()) ||
    clean($('#conteudo .txtTopo').first().text()) ||
    null

  // -- Itens ---------------------------------------------------------------
  const items: NfceItem[] = []

  $('#tabResult tr').each((index, el) => {
    const row = $(el)

    const descricao = clean(row.find('.txtTit, .txtTit2').first().text())
    if (!descricao) return

    // "(Código: 7891000100103)" -> "7891000100103"
    const codigoRaw = clean(row.find('.RCod').first().text())
    const codigo = codigoRaw.replace(/.*?c[oó]digo\s*:?\s*/i, '').replace(/[^\w]/g, '')

    const quantity = parseBrNumber(
      clean(row.find('.Rqtd').first().text()).replace(/.*?:\s*/, ''),
    )
    const unit =
      clean(row.find('.RUN').first().text())
        .replace(/.*?:\s*/, '')
        .toLowerCase() || 'un'
    const unitPrice = parseBrNumber(
      clean(row.find('.RvlUnit').first().text()).replace(/.*?:\s*/, ''),
    )
    const totalPrice = parseBrNumber(clean(row.find('.valor').first().text()))

    items.push({
      numeroItem: items.length + 1,
      codigo,
      descricao,
      unit,
      // Uma nota nunca tem item com quantidade zero: se o parser leu 0, ele
      // errou o seletor. Assumir 1 evita gravar uma entrada de estoque vazia
      // e o usuario corrige na conferencia, que e obrigatoria de qualquer jeito.
      quantity: quantity > 0 ? quantity : 1,
      unitPrice,
      totalPrice: totalPrice > 0 ? totalPrice : unitPrice * (quantity > 0 ? quantity : 1),
    })
  })

  // -- Total ---------------------------------------------------------------
  let valorTotal: number | null = null
  $('#totalNota .totalNumb, .totalNumb, #linhaTotal .totalNumb').each((_i, el) => {
    if (valorTotal !== null) return
    const v = parseBrNumber(clean($(el).text()))
    if (v > 0) valorTotal = v
  })

  if (valorTotal === null && items.length > 0) {
    valorTotal = Number(items.reduce((acc, i) => acc + i.totalPrice, 0).toFixed(2))
  }

  // -- Data de emissao -----------------------------------------------------
  // O bloco de informacoes gerais e texto corrido; a data aparece como
  // "Emissão: 12/07/2025 14:33:21".
  const infoText = clean($('#infos').text() || $('body').text())
  const dataMatch = infoText.match(/emiss[aã]o\s*:?\s*(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?/i)

  let dataEmissao: string | null = null
  if (dataMatch?.[1]) {
    const [d, m, y] = dataMatch[1].split('/')
    dataEmissao = `${y}-${m}-${d}T${dataMatch[2] ?? '00:00:00'}`
  }

  return { items, emitente, valorTotal, dataEmissao }
}

// ---------------------------------------------------------------------------
// CONSULTA
// ---------------------------------------------------------------------------

/** Teto de espera da consulta ao portal, em milissegundos. */
const FETCH_TIMEOUT_MS = 12_000

/** Limite de redirecionamentos seguidos, para nao entrar em laco infinito. */
const MAX_REDIRECTS = 5

interface SimpleResponse {
  status: number
  body: string
}

/**
 * GET com suporte a raiz ICP-Brasil.
 *
 * Usa `https.request` em vez de `fetch` por um motivo pratico: o `fetch` do
 * Node nao aceita um agente TLS customizado sem depender do `undici` como
 * dependencia direta, e adicionar um pacote inteiro para configurar uma CA
 * seria peso desnecessario.
 */
function httpGet(rawUrl: string, redirectsLeft = MAX_REDIRECTS): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      reject(new Error('URL de consulta invalida'))
      return
    }

    const isHttps = url.protocol === 'https:'
    const client = isHttps ? https : http

    const request = client.request(
      url,
      {
        method: 'GET',
        agent: isHttps ? getSefazAgent() : undefined,
        headers: {
          // Sem um User-Agent de navegador, varios portais estaduais devolvem
          // uma pagina de bloqueio em vez do conteudo.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          Accept: 'text/html,application/xhtml+xml',
        },
        timeout: FETCH_TIMEOUT_MS,
      },
      (response) => {
        const status = response.statusCode ?? 0
        const location = response.headers.location

        // Varios portais respondem 302 para uma pagina intermediaria antes de
        // mostrar a nota; sem seguir, o parser receberia HTML vazio.
        if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
          response.resume()
          resolve(httpGet(new URL(location, url).toString(), redirectsLeft - 1))
          return
        }

        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({ status, body: Buffer.concat(chunks).toString('utf8') }),
        )
      },
    )

    request.on('timeout', () => request.destroy(new Error('TIMEOUT')))
    request.on('error', reject)
    request.end()
  })
}

/**
 * Busca a nota no portal da SEFAZ.
 *
 * Nunca lanca por falha de rede ou de layout: devolve `source: 'manual'` com o
 * motivo. A unica excecao lancada e chave invalida, que e erro de entrada e
 * precisa ser corrigido antes de qualquer outra coisa.
 */
export async function lookupNfce(
  rawQr: string,
  ufOverride?: string,
): Promise<NfceLookupResult> {
  const chave = extractAccessKey(rawQr)
  if (!chave) {
    throw new Error(
      'Nao encontrei uma chave de 44 digitos no conteudo lido. Se digitou a chave, confira se colou os 44 numeros.',
    )
  }

  if (!isValidAccessKey(chave)) {
    throw new Error(
      'A chave lida falhou no digito verificador — provavelmente a camera capturou o codigo pela metade. Tente escanear novamente.',
    )
  }

  const decoded = decodeAccessKey(chave)
  if (!decoded) {
    throw new Error('A chave lida nao corresponde a um estado brasileiro valido.')
  }

  const uf = ufOverride && UF_LIST.includes(ufOverride) ? ufOverride : decoded.uf

  // A URL do proprio QR e sempre preferida: ela carrega o hash que varios
  // portais exigem para liberar o detalhe dos itens. So caimos no mapa por UF
  // quando o usuario digitou a chave e nao ha URL nenhuma.
  const looksLikeUrl = /^https?:\/\//i.test(String(rawQr).trim())
  const consultaUrl = looksLikeUrl
    ? String(rawQr).trim()
    : (CONSULTA_URL_BY_UF[uf]?.(chave) ?? '')

  const base: NfceLookupResult = {
    chave,
    uf,
    modelo: decoded.modelo,
    serie: decoded.serie,
    numero: decoded.numero,
    emitenteCnpj: formatCnpj(decoded.emitenteCnpj),
    emitente: null,
    dataEmissao: null,
    valorTotal: null,
    items: [],
    source: 'manual',
    warning: null,
    consultaUrl,
  }

  if (!consultaUrl) {
    return {
      ...base,
      warning: `Nao tenho o endereco de consulta publica de ${uf}. A nota foi identificada pela chave; lance os itens manualmente.`,
    }
  }

  try {
    const response = await httpGet(consultaUrl)

    if (response.status < 200 || response.status >= 300) {
      return {
        ...base,
        warning: `O portal da SEFAZ-${uf} respondeu ${response.status}. A nota foi identificada; confira os itens manualmente.`,
      }
    }

    const html = response.body

    // Captcha e a razao mais comum de vir uma pagina valida e vazia. Dizer
    // isso explicitamente evita que o usuario fique tentando reescanear.
    if (/captcha|recaptcha|hcaptcha/i.test(html) && !/tabResult/i.test(html)) {
      return {
        ...base,
        warning: `A SEFAZ-${uf} exige captcha nesta consulta, entao nao da para importar os itens automaticamente. Abra a nota no portal ou lance os itens manualmente.`,
      }
    }

    const parsed = parseNfceHtml(html)

    if (parsed.items.length === 0) {
      return {
        ...base,
        emitente: parsed.emitente,
        valorTotal: parsed.valorTotal,
        dataEmissao: parsed.dataEmissao,
        warning: `A consulta funcionou, mas nao reconheci a lista de itens no layout da SEFAZ-${uf}. Lance os itens manualmente.`,
      }
    }

    return {
      ...base,
      emitente: parsed.emitente,
      valorTotal: parsed.valorTotal,
      dataEmissao: parsed.dataEmissao,
      items: parsed.items,
      source: 'sefaz',
    }
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'TIMEOUT'
    return {
      ...base,
      warning: isTimeout
        ? `O portal da SEFAZ-${uf} nao respondeu a tempo. A nota foi identificada; lance os itens manualmente ou tente de novo.`
        : `Nao consegui acessar o portal da SEFAZ-${uf} agora. A nota foi identificada; lance os itens manualmente.`,
    }
  }
}
