/**
 * Contratos das rotas de `/api/scanner`, espelhados do backend.
 *
 * Os campos numericos vindos do Prisma chegam como `string` no JSON (Decimal
 * serializa assim), por isso `number | string` em estoque e preco: tratar isso
 * no tipo obriga cada uso a passar por `Number()` e evita o classico
 * `"12" + 1 === "121"` numa soma de estoque.
 */

export interface LookupIngredient {
  id: string
  name: string
  unit: string
  stock: number | string
  minimumStock: number | string
  price: number | string
  sku: string | null
  barcode: string | null
  active: boolean
}

export interface LookupProduct {
  id: string
  name: string
  price: number | string
  sku: string | null
  barcode: string | null
  active: boolean
}

/** Resposta de `GET /api/scanner/lookup?code=` */
export interface LookupResult {
  code: string
  ingredient: LookupIngredient | null
  product: LookupProduct | null
  found: boolean
}

/** Sugestao de vinculo de um item da nota com o cadastro. */
export interface NfceMatch {
  ingredientId: string
  name: string
  unit: string
  stock: number
  price: number
  /** `barcode` e praticamente certo; `nome` e palpite. A tela os separa. */
  matchedBy: 'barcode' | 'nome' | null
  confidence: number
}

export interface NfceItem {
  numeroItem: number
  codigo: string
  descricao: string
  unit: string
  quantity: number
  unitPrice: number
  totalPrice: number
  match: NfceMatch | null
}

/** Resposta de `POST /api/scanner/nfce` */
export interface NfceResult {
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
  /** `sefaz` = itens lidos do portal. `manual` = so a chave foi identificada. */
  source: 'sefaz' | 'manual'
  warning: string | null
  consultaUrl: string
  alreadyImported: {
    id: string
    importedAt: string
    emitente: string | null
    sameTenant: boolean
  } | null
}

/** Item do corpo de `POST /api/scanner/stock-entry`. */
export interface StockEntryItem {
  action: 'link' | 'create'
  ingredientId?: string
  name?: string
  unit?: string
  barcode?: string | null
  codigo?: string
  descricao?: string
  quantity: number
  unitPrice: number
}

/** Resposta de `POST /api/scanner/stock-entry` */
export interface StockEntryResult {
  invoiceId: string | null
  itemsApplied: number
  createdIngredients: number
  details: Array<{
    name: string
    unit: string
    quantity: number
    before: number
    after: number
    createdIngredient: boolean
    ingredientId: string
  }>
}

/** Insumo do cadastro, para o seletor de vinculo manual. */
export interface IngredientOption {
  id: string
  name: string
  unit: string
  stock: number | string
  barcode: string | null
}
