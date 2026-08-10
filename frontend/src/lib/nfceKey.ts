/**
 * Leitura e validacao da chave de acesso da NFC-e, no cliente.
 *
 * Espelha `extractAccessKey` e `isValidAccessKey` do backend de proposito. Nao e
 * duplicacao por descuido: validar aqui evita uma ida ao servidor (e uma ida do
 * servidor ate a SEFAZ) para descobrir que a camera capturou o codigo pela
 * metade. O backend continua validando — esta copia so antecipa o diagnostico
 * para o operador, que precisa saber na hora que deve escanear de novo.
 *
 * Se um dia a regra do DV mudar, os dois lados mudam junto; e o modulo 11 da
 * chave de 44 digitos e definido pela SEFAZ e nao muda na pratica.
 */

/** Extrai a sequencia de 44 digitos de uma URL de QR, de texto colado ou da digitacao. */
export function extractAccessKey(raw: string): string | null {
  const text = String(raw ?? '')
  const digitsOnly = text.replace(/\D/g, '')

  // A chave vem "limpa" quando o usuario digita, e embutida numa URL longa
  // quando vem do QR. Procurar uma janela de exatamente 44 digitos cobre os
  // dois casos sem precisar saber a origem do texto.
  if (digitsOnly.length === 44) return digitsOnly

  const match = text.match(/\d{44}/)
  if (match) return match[0]

  // Ultimo recurso: o parametro `p` traz a chave antes do primeiro `|`.
  const pParam = text.match(/[?&]p=([^&\s]+)/i)
  if (pParam?.[1]) {
    try {
      const first = (decodeURIComponent(pParam[1]).split('|')[0] ?? '').replace(/\D/g, '')
      if (first.length === 44) return first
    } catch {
      // `decodeURIComponent` lanca em `%` solto — um QR lido pela metade. Cai fora.
    }
  }

  return null
}

/**
 * Valida o digito verificador (modulo 11) da chave de acesso.
 *
 * Uma chave com um digito trocado produz uma consulta que a SEFAZ recusa com
 * mensagem generica. Validar localmente transforma um "erro do portal"
 * incompreensivel em "a leitura saiu incompleta, tente de novo".
 */
export function isValidAccessKey(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false

  const base = chave.slice(0, 43)
  const dv = Number(chave[43])

  // Pesos ciclicos de 2 a 9, da direita para a esquerda.
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

/**
 * Um texto lido pela camera parece ser uma NFC-e?
 *
 * Usado para decidir, no modo automatico, se o QR lido e uma nota ou um codigo
 * de barras de embalagem.
 */
export function looksLikeNfce(raw: string): boolean {
  return extractAccessKey(raw) !== null
}
