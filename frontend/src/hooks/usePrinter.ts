/**
 * Impressao de comanda pelo proprio navegador — o modelo do iFood.
 *
 * A versao anterior deste hook so funcionava dentro do Electron: checava
 * `window.electron?.isElectron` e, fora dele, apenas escrevia um `console.warn`
 * e devolvia `{ success: false }`. Como o Electron foi removido do projeto,
 * `isElectron` era SEMPRE falso — ou seja, nenhuma comanda era impressa, e o
 * PDV nao avisava nada porque o retorno era ignorado. A cozinha simplesmente
 * nao recebia o pedido.
 *
 * Aqui o cupom e montado como HTML dentro de um iframe oculto e enviado para
 * `window.print()`. O diálogo nativo abre e o operador escolhe a impressora
 * termica — sem ESC/POS, sem driver especial, sem agente local. Funciona no
 * Chrome, Edge e Firefox, no Windows, Mac e Linux.
 */

export interface PrintResult {
  success: boolean
  error?: string
}

export interface PrintItem {
  productName: string
  quantity: number
  observations?: string
  selectedProteinName?: string
}

export interface PrintKitchenPayload {
  orderNumber: string
  orderType: string
  items: PrintItem[]
  observations?: string
  createdAt: string
}

export interface PrintDeliveryPayload {
  orderNumber: string
  customerName: string
  customerPhone: string
  address: string
  items: PrintItem[]
  totalAmount: number
  paymentMethod: string
  observations?: string
  createdAt: string
  /** Opcionais: quando ausentes, a linha simplesmente nao e impressa. */
  deliveryFee?: number
  changeFor?: number
}

/** Largura da bobina. 80mm e o padrao; 58mm existe em impressoras menores. */
export type PaperWidth = '58mm' | '80mm'

const PAPER_KEY = 'delivery_erp_paper_width'

export function getPaperWidth(): PaperWidth {
  try {
    return localStorage.getItem(PAPER_KEY) === '58mm' ? '58mm' : '80mm'
  } catch {
    return '80mm'
  }
}

export function setPaperWidth(width: PaperWidth) {
  try {
    localStorage.setItem(PAPER_KEY, width)
  } catch {
    /* ignora: cai no padrao 80mm */
  }
}

// ---------------------------------------------------------------------------
// MONTAGEM DO CUPOM
// ---------------------------------------------------------------------------

/**
 * Escapa o texto antes de injetar no HTML.
 *
 * Nomes de produto e observacoes vem do banco e podem conter `<` ou `&`. Sem
 * escapar, uma observacao como "molho < 1 colher" quebraria o cupom.
 */
function esc(value: string | number | undefined | null): string {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`
}

function dateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  delivery: 'DELIVERY',
  balcao: 'BALCAO',
  mesa: 'MESA',
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Dinheiro',
  credit: 'Credito',
  debit: 'Debito',
  pix: 'PIX',
  voucher: 'Vale',
}

/**
 * CSS do cupom.
 *
 * `@page { size: <largura> auto; margin: 0 }` e o que faz o Chrome tratar a
 * pagina como bobina continua em vez de A4 — sem isso o cupom sai centralizado
 * numa folha inteira e desperdica papel.
 */
function receiptStyles(width: PaperWidth): string {
  return `
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      width: ${width};
      font-family: "Courier New", Courier, monospace;
      color: #000; background: #fff;
    }
    body { padding: 4mm 3mm; font-size: ${width === '58mm' ? '11px' : '12px'}; line-height: 1.35; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .big { font-size: ${width === '58mm' ? '15px' : '17px'}; font-weight: bold; }
    .rule { border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; gap: 6px; }
    .item { margin-bottom: 6px; }
    .item-name { font-weight: bold; }
    /* Recuo para a proteina e a observacao ficarem visivelmente subordinadas
       ao item — a cozinha le em segundos, nao pode haver ambiguidade. */
    .item-sub { padding-left: 10px; }
    .total { font-size: ${width === '58mm' ? '14px' : '16px'}; font-weight: bold; }
    .footer { margin-top: 8px; text-align: center; font-size: 10px; }
  `
}

function itemsHtml(items: PrintItem[]): string {
  return items
    .map((i) => {
      const lines = [
        `<div class="item-name">${i.quantity}x ${esc(i.productName)}</div>`,
      ]
      if (i.selectedProteinName) {
        lines.push(`<div class="item-sub">- ${esc(i.selectedProteinName)}</div>`)
      }
      if (i.observations) {
        lines.push(`<div class="item-sub bold">OBS: ${esc(i.observations)}</div>`)
      }
      return `<div class="item">${lines.join('')}</div>`
    })
    .join('')
}

function kitchenHtml(p: PrintKitchenPayload, width: PaperWidth): string {
  const totalItems = p.items.reduce((acc, i) => acc + i.quantity, 0)
  return `
    <div class="center big">COZINHA</div>
    <div class="center bold">${esc(ORDER_TYPE_LABELS[p.orderType] ?? p.orderType)}</div>
    <div class="rule"></div>
    <div class="row"><span class="bold">Pedido</span><span class="bold">#${esc(p.orderNumber)}</span></div>
    <div class="row"><span>Hora</span><span>${esc(dateTime(p.createdAt))}</span></div>
    <div class="row"><span>Itens</span><span>${totalItems}</span></div>
    <div class="rule"></div>
    ${itemsHtml(p.items)}
    ${
      p.observations
        ? `<div class="rule"></div><div class="bold">OBS DO PEDIDO:</div><div>${esc(p.observations)}</div>`
        : ''
    }
    <div class="rule"></div>
    <div class="footer">via cozinha${width === '58mm' ? ' - 58mm' : ''}</div>
  `
}

function deliveryHtml(p: PrintDeliveryPayload): string {
  const subtotal = p.totalAmount - (p.deliveryFee ?? 0)
  const change =
    p.changeFor != null && p.changeFor > p.totalAmount
      ? p.changeFor - p.totalAmount
      : null

  return `
    <div class="center big">ENTREGA</div>
    <div class="rule"></div>
    <div class="row"><span class="bold">Pedido</span><span class="bold">#${esc(p.orderNumber)}</span></div>
    <div class="row"><span>Hora</span><span>${esc(dateTime(p.createdAt))}</span></div>
    <div class="rule"></div>
    <div class="bold">${esc(p.customerName)}</div>
    ${p.customerPhone ? `<div>${esc(p.customerPhone)}</div>` : ''}
    ${p.address ? `<div>${esc(p.address)}</div>` : ''}
    <div class="rule"></div>
    ${itemsHtml(p.items)}
    <div class="rule"></div>
    ${
      p.deliveryFee != null && p.deliveryFee > 0
        ? `<div class="row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
           <div class="row"><span>Taxa de entrega</span><span>${money(p.deliveryFee)}</span></div>`
        : ''
    }
    <div class="row total"><span>TOTAL</span><span>${money(p.totalAmount)}</span></div>
    <div class="row"><span>Pagamento</span><span>${esc(PAYMENT_LABELS[p.paymentMethod] ?? p.paymentMethod)}</span></div>
    ${
      p.changeFor != null && p.changeFor > 0
        ? `<div class="row"><span>Troco para</span><span>${money(p.changeFor)}</span></div>`
        : ''
    }
    ${
      change != null
        ? `<div class="row bold"><span>LEVAR DE TROCO</span><span>${money(change)}</span></div>`
        : ''
    }
    ${
      p.observations
        ? `<div class="rule"></div><div class="bold">OBS:</div><div>${esc(p.observations)}</div>`
        : ''
    }
    <div class="rule"></div>
    <div class="footer">via entregador</div>
  `
}

// ---------------------------------------------------------------------------
// IMPRESSAO
// ---------------------------------------------------------------------------

/**
 * Imprime um cupom em iframe oculto.
 *
 * Usar iframe (em vez de `window.open`) evita o bloqueador de pop-up e nao
 * perde o estado do PDV. O iframe e removido depois, com um atraso: remover
 * imediatamente apos `print()` cancela o job no Safari e no Firefox, porque o
 * diálogo ainda esta lendo o documento.
 */
function printHtml(title: string, body: string, width: PaperWidth): Promise<PrintResult> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      resolve({ success: false, error: 'Impressao indisponivel neste ambiente.' })
      return
    }

    const iframe = document.createElement('iframe')
    // `visibility: hidden` em vez de `display: none`: alguns navegadores nao
    // renderizam (e portanto nao imprimem) um iframe com display none.
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.visibility = 'hidden'

    let settled = false
    const finish = (result: PrintResult) => {
      if (settled) return
      settled = true
      window.setTimeout(() => iframe.remove(), 1000)
      resolve(result)
    }

    // Guarda contra impressao DUPLICADA: o fallback de `readyState` abaixo pode
    // disparar `onload` manualmente enquanto o navegador tambem dispara o evento
    // nativo. Sem esta trava, `print()` era chamado duas vezes e saiam dois
    // cupons identicos por pedido — papel desperdicado e a cozinha em duvida se
    // era um pedido novo. O guard `settled` do finish nao bastava, porque o
    // print acontece ANTES dele.
    let printStarted = false

    iframe.onload = () => {
      if (printStarted) return
      printStarted = true
      try {
        const win = iframe.contentWindow
        if (!win) {
          finish({ success: false, error: 'Nao foi possivel preparar a impressao.' })
          return
        }
        win.focus()
        win.print()
        finish({ success: true })
      } catch (err) {
        finish({
          success: false,
          error: err instanceof Error ? err.message : 'Falha ao abrir a impressao.',
        })
      }
    }

    document.body.appendChild(iframe)

    const doc = iframe.contentDocument
    if (!doc) {
      finish({ success: false, error: 'Nao foi possivel preparar a impressao.' })
      return
    }

    doc.open()
    doc.write(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
        `<title>${esc(title)}</title><style>${receiptStyles(width)}</style></head>` +
        `<body>${body}</body></html>`,
    )
    doc.close()

    // Documentos escritos via `document.write` as vezes ja estao completos e
    // nao disparam `onload`. Este fallback garante que a impressao aconteca.
    if (doc.readyState === 'complete') iframe.onload?.(new Event('load'))
  })
}

export function usePrinter() {
  const paperWidth = getPaperWidth()

  async function printKitchen(payload: PrintKitchenPayload): Promise<PrintResult> {
    return printHtml(
      `Comanda cozinha #${payload.orderNumber}`,
      kitchenHtml(payload, paperWidth),
      paperWidth,
    )
  }

  async function printDelivery(payload: PrintDeliveryPayload): Promise<PrintResult> {
    return printHtml(
      `Comanda entrega #${payload.orderNumber}`,
      deliveryHtml(payload),
      paperWidth,
    )
  }

  /** Cupom de teste, para calibrar a largura da bobina antes de usar valendo. */
  async function testPrint(): Promise<PrintResult> {
    return printKitchen({
      orderNumber: 'TESTE',
      orderType: 'balcao',
      createdAt: new Date().toISOString(),
      observations: 'Cupom de teste de impressao.',
      items: [
        { productName: 'Marmita de teste', quantity: 1, selectedProteinName: 'Frango' },
        { productName: 'Refrigerante', quantity: 2, observations: 'bem gelado' },
      ],
    })
  }

  return { printKitchen, printDelivery, testPrint, paperWidth }
}
