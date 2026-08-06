/**
 * Perguntas de seguranca para recuperacao de senha.
 *
 * Sao 4 opcoes; o dono escolhe 2 no cadastro. Todas pedem resposta curta,
 * estavel no tempo e que a pessoa nao esquece — evitamos datas de proposito,
 * porque "10/03/1990" e "10-03-90" seriam respostas diferentes para o mesmo
 * fato e travariam a recuperacao.
 */

export const SECURITY_QUESTIONS = {
  birthCity: 'Em qual cidade você nasceu?',
  firstPet: 'Qual o nome do seu primeiro animal de estimação?',
  motherName: 'Qual o nome completo da sua mãe?',
  childhoodNickname: 'Qual era seu apelido de infância?',
} as const

export type SecurityQuestionKey = keyof typeof SECURITY_QUESTIONS

export const SECURITY_QUESTION_KEYS = Object.keys(SECURITY_QUESTIONS) as SecurityQuestionKey[]

/**
 * Normaliza a resposta antes de gerar/comparar o hash.
 *
 * Sem isso a recuperacao seria inutilizavel na pratica: quem cadastrou
 * "São Paulo" digitaria "sao paulo" meses depois e nao entraria. Como o hash
 * bcrypt e sensivel a qualquer diferenca de byte, a normalizacao tem que
 * acontecer ANTES do hash — nos dois lados (cadastro e verificacao).
 *
 * Aplica: minusculas, remocao de acentos, espacos colapsados e trim.
 */
export function normalizeAnswer(answer: string): string {
  return answer
    .normalize('NFD')
    // Remove os diacriticos separados pelo NFD (acentos, cedilha).
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Valida se a chave recebida do cliente e uma das perguntas conhecidas. */
export function isValidQuestionKey(key: unknown): key is SecurityQuestionKey {
  return typeof key === 'string' && key in SECURITY_QUESTIONS
}
