/**
 * Espelho do catalogo de permissoes do backend (`backend/src/lib/permissions.ts`).
 *
 * Por que duplicar em vez de importar: sao dois pacotes separados, com tsconfig
 * e build proprios — o frontend nao tem como importar de `../../backend/src`.
 *
 * O risco dessa duplicacao e a lista aqui envelhecer. Duas defesas:
 *  - a tela de funcionarios NAO usa esta lista para montar o formulario; ela le
 *    `GET /api/users/permissions`, que vem do servidor. Aqui ficam apenas os
 *    rotulos usados fora daquela tela (ex.: resumo de acesso do funcionario).
 *  - o servidor descarta chaves desconhecidas (`sanitizePermissions`), entao uma
 *    chave defasada daqui nunca concede acesso indevido.
 *
 * REGRA: `can()` e apenas cosmetico — esconde botao e item de menu. Quem autoriza
 * de verdade e o servidor, que revalida o vinculo em cada requisicao.
 */

/** Papel dentro de um negocio. */
export type MembershipRole = 'owner' | 'staff'

/**
 * Chaves que o dono distribui. Espelha `PERMISSIONS` do backend.
 *
 * `users:manage` e `business:manage` nao existem de proposito: gerenciar equipe e
 * editar o negocio sao exclusivos do owner. Se fossem permissoes marcaveis, o
 * dono poderia conceder "gerenciar funcionarios" e a pessoa se promoveria a
 * owner, tomando a loja.
 */
export const PERMISSION_LABELS: Record<string, string> = {
  'pdv:use': 'Lançar vendas no PDV',
  'kitchen:view': 'Ver a tela da cozinha',
  'scanner:use': 'Usar o scanner de código de barras',
  'orders:view': 'Ver pedidos',
  'orders:manage': 'Alterar e cancelar pedidos',
  'products:view': 'Ver produtos e fichas técnicas',
  'products:manage': 'Criar e editar produtos',
  'ingredients:view': 'Ver insumos e estoque',
  'ingredients:manage': 'Lançar entrada e ajustar estoque',
  'invoices:manage': 'Importar notas fiscais',
  'purchases:view': 'Ver fornecedores e pedidos de compra',
  'purchases:manage': 'Criar, aprovar e receber compras',
  'customers:view': 'Ver clientes',
  'customers:manage': 'Criar e editar clientes',
  'pricing:view': 'Ver preços e simulador',
  'pricing:manage': 'Alterar preços e margens',
  'reports:view': 'Ver faturamento e indicadores',
  'cash:operate': 'Abrir o caixa e lançar suprimento',
  'cash:close': 'Fazer sangria e fechar o caixa',
  'payables:view': 'Ver contas a pagar',
  'payables:manage': 'Lançar contas e dar baixa em pagamento',
  'delivery:manage': 'Gerenciar entregas, entregadores e taxas',
  'delivery:drive': 'Usar a área móvel do entregador',
  'printer:manage': 'Configurar impressora',
  'store:toggle': 'Abrir e fechar a loja',
}

/** Rotulo legivel de uma chave, com fallback para chave desconhecida. */
export function permissionLabel(key: string): string {
  return PERMISSION_LABELS[key] ?? key
}

/**
 * Texto curto do acesso de alguem, para a lista de funcionarios.
 *
 * Listar 17 permissoes numa linha de tabela e ilegivel; o dono quer saber "o que
 * essa pessoa faz aqui" de relance e abre o formulario quando precisa do detalhe.
 */
export function permissionSummary(role: string, permissions: string[]): string {
  if (role === 'owner') return 'Acesso total (dono)'
  if (permissions.length === 0) return 'Nenhum acesso liberado'
  const first = permissionLabel(permissions[0]!)
  if (permissions.length === 1) return first
  return `${first} e mais ${permissions.length - 1}`
}
