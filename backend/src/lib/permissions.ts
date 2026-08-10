/**
 * Catalogo de permissoes — fonte unica da verdade.
 *
 * O mesmo arquivo alimenta o formulario do dono, o menu lateral e os guards das
 * rotas. Duplicar essa lista era o caminho mais curto para o menu esconder algo
 * que a API continuava liberando (ou o contrario).
 *
 * O espelho no frontend (`frontend/src/lib/permissions.ts`) reexporta estes
 * mesmos valores.
 */

/** Papel dentro de um negocio. */
export type MembershipRole = 'owner' | 'staff'

/**
 * Permissoes que o dono distribui.
 *
 * Leitura e escrita sao separadas onde envolve dinheiro: um caixa pode precisar
 * consultar preco sem poder altera-lo.
 *
 * `users:manage` e `business:manage` NAO estao aqui de proposito — sao
 * exclusivos do owner. Se entrassem no catalogo, o dono poderia marcar
 * "gerenciar funcionarios" para um funcionario, que se promoveria a owner e
 * tomaria a loja.
 */
export const PERMISSIONS = {
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
  'customers:view': 'Ver clientes',
  'customers:manage': 'Criar e editar clientes',
  'pricing:view': 'Ver preços e simulador',
  'pricing:manage': 'Alterar preços e margens',
  'reports:view': 'Ver faturamento e indicadores',
  // Operar o caixa e conferir o fechamento sao coisas diferentes: o caixa abre
  // o turno e lanca a venda, mas quem confere a gaveta e fecha o turno
  // responde pela diferenca. Sangria idem — e retirada de dinheiro.
  'cash:operate': 'Abrir o caixa e lançar suprimento',
  'cash:close': 'Fazer sangria e fechar o caixa',
  'payables:view': 'Ver contas a pagar',
  'payables:manage': 'Lançar contas e dar baixa em pagamento',
  'delivery:manage': 'Configurar bairros e taxas',
  'printer:manage': 'Configurar impressora',
  // Fechar a loja derruba o faturamento na hora: o cardapio para de aceitar
  // pedido. Merece chave propria — antes `PATCH /api/store/toggle` nao exigia
  // nada, e qualquer funcionario logado podia fechar a loja no movimento.
  'store:toggle': 'Abrir e fechar a loja',
} as const

export type Permission = keyof typeof PERMISSIONS

/** Todas as chaves validas, para validar o que chega do cliente. */
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[]

/**
 * Agrupamento para a UI. Segue o menu lateral para o dono reconhecer onde cada
 * permissao aparece na pratica.
 */
export const PERMISSION_GROUPS: { title: string; keys: Permission[] }[] = [
  { title: 'Operação', keys: ['pdv:use', 'kitchen:view', 'scanner:use', 'store:toggle'] },
  { title: 'Pedidos', keys: ['orders:view', 'orders:manage'] },
  { title: 'Produtos e estoque', keys: ['products:view', 'products:manage', 'ingredients:view', 'ingredients:manage', 'invoices:manage'] },
  { title: 'Clientes', keys: ['customers:view', 'customers:manage'] },
  {
    title: 'Financeiro',
    keys: [
      'pricing:view', 'pricing:manage', 'reports:view',
      'cash:operate', 'cash:close',
      'payables:view', 'payables:manage',
    ],
  },
  { title: 'Configurações', keys: ['delivery:manage', 'printer:manage'] },
]

/**
 * Conjuntos prontos para os cargos comuns, usados como ponto de partida ao
 * criar um funcionario. O dono ajusta as caixas depois — o cargo aqui e so um
 * atalho, nao uma regra fixa.
 */
export const ROLE_PRESETS = {
  manager: {
    label: 'Gerente',
    permissions: [
      'pdv:use', 'kitchen:view', 'scanner:use',
      'orders:view', 'orders:manage',
      'products:view', 'products:manage',
      'ingredients:view', 'ingredients:manage', 'invoices:manage',
      'customers:view', 'customers:manage',
      'pricing:view', 'reports:view',
      'cash:operate', 'cash:close',
      'payables:view', 'payables:manage',
      'store:toggle',
    ],
  },
  cashier: {
    label: 'Caixa',
    permissions: [
      'pdv:use', 'orders:view', 'customers:view', 'customers:manage', 'scanner:use',
      // Abre o turno e lanca suprimento, mas nao fecha o caixa nem faz sangria:
      // quem confere a gaveta nao pode ser quem a operou sozinho.
      'cash:operate',
    ],
  },
  waiter: {
    label: 'Garçom',
    permissions: ['pdv:use', 'orders:view', 'customers:view'],
  },
  kitchen: {
    label: 'Cozinha',
    permissions: ['kitchen:view', 'orders:view', 'ingredients:view'],
  },
  delivery: {
    label: 'Entregador',
    permissions: ['orders:view'],
  },
  // `satisfies` (em vez de `: Record<string, ...>`) valida que toda chave acima
  // existe no catalogo E preserva os nomes dos presets, para `ROLE_PRESETS.manager`
  // nao ser tratado como possivelmente indefinido por quem consome.
} satisfies Record<string, { label: string; permissions: Permission[] }>

/** Descarta chaves desconhecidas (catalogo pode encolher entre versoes). */
export function sanitizePermissions(input: unknown): Permission[] {
  if (!Array.isArray(input)) return []
  const valid = new Set<string>(ALL_PERMISSIONS)
  // Set remove duplicatas: a mesma chave repetida nao muda o acesso, mas suja
  // a lista salva e a auditoria.
  return [...new Set(input.filter((p): p is Permission => typeof p === 'string' && valid.has(p)))]
}

/**
 * Checagem central de acesso.
 *
 * Owner passa sempre: dono nao depende de lista, senao uma permissao nova
 * lancada no futuro deixaria a propria loja inacessivel para ele.
 */
export function hasPermission(
  role: string | undefined,
  permissions: string[] | undefined,
  required: Permission,
): boolean {
  if (role === 'owner') return true
  return Array.isArray(permissions) && permissions.includes(required)
}
