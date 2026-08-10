/**
 * Tipos e utilitarios compartilhados pelas partes do PDV.
 *
 * Ficam num arquivo proprio porque a grade de produtos, a comanda e o dialogo de
 * pagamento manipulam as mesmas estruturas. Duplicar as interfaces em cada
 * arquivo levaria a versoes divergentes do mesmo item de carrinho.
 */

// ─── Produtos ─────────────────────────────────────────────────────────────────

export interface ComboOption {
  group: string
  label: string
  ingredientId: string
}

/**
 * Adicional vendavel junto do produto (bacon extra, borda, refil).
 *
 * `maxQuantity` e `required` vem do cadastro e sao validados TAMBEM no servidor;
 * aqui servem para a interface nao deixar o operador montar algo que a API vai
 * recusar depois — errar so no fim da venda e o pior momento possivel.
 */
export interface ProductAddonRow {
  id: string
  name: string
  price: string
  groupName: string
  required: boolean
  maxQuantity: number
}

export interface Product {
  id: string
  name: string
  sku: string
  price: string
  barcode?: string | null
  addons?: ProductAddonRow[] | null
  category: string | null
  /**
   * A categoria real vem da relacao `menuCategory`; `category` e um texto legado
   * que hoje chega nulo. Sem olhar a relacao primeiro, toda a grade cai em
   * "Outros".
   */
  menuCategory?: { id: string; name: string } | null
  productType: string
  comboOptions: ComboOption[] | null
  active: boolean
  imageUrl?: string | null
}

/** Categoria exibida nas abas: relacao primeiro, texto legado depois. */
export function productCategory(p: Product): string {
  return p.menuCategory?.name || p.category || 'Outros'
}

// ─── Comanda ──────────────────────────────────────────────────────────────────

export interface CartItem {
  /**
   * Identidade da LINHA, nao do produto.
   *
   * Duas linhas do mesmo produto podem coexistir com observacoes diferentes
   * ("sem cebola" e "bem passado"). Usar o `productId` como chave faria o React
   * embaralhar as linhas ao remover uma delas, e o "+" de uma somaria na outra.
   */
  lineId: string
  product: Product
  quantity: number
  observations: string
  selectedProtein: ComboOption | null
  /** Adicionais escolhidos para ESTA linha, com a quantidade de cada um. */
  addons: ChosenAddon[]
}

/** Um adicional escolhido, com a quantidade pedida. */
export interface ChosenAddon {
  addonId: string
  name: string
  price: number
  quantity: number
}

/** Gera um id de linha unico e legivel em depuracao. */
export function newLineId(): string {
  return `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** Preco unitario do produto, sem adicionais. */
export function lineUnitPrice(item: CartItem): number {
  return Number(item.product.price) || 0
}

/** Soma dos adicionais de UMA unidade do produto. */
export function addonsUnitPrice(item: CartItem): number {
  return item.addons.reduce((sum, a) => sum + a.price * a.quantity, 0)
}

/**
 * Total da linha, adicionais incluidos.
 *
 * Espelha o calculo do servidor (`addonPrice * addonQty * itemQty`): pedir 2
 * marmitas com bacon extra cobra o bacon duas vezes. Se o PDV somasse o bacon
 * uma unica vez, o total na tela ficaria abaixo do total real do pedido.
 */
export function lineTotal(item: CartItem): number {
  return (lineUnitPrice(item) + addonsUnitPrice(item)) * item.quantity
}

// ─── Pagamento ────────────────────────────────────────────────────────────────

export type PaymentMethod = 'cash' | 'credit' | 'debit' | 'pix' | 'voucher' | 'fiado'

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  credit: 'Crédito',
  debit: 'Débito',
  pix: 'PIX',
  voucher: 'Vale',
  fiado: 'Fiado',
}

/**
 * Ordem em que as formas aparecem no dialogo.
 *
 * Dinheiro primeiro porque e o unico que exige conta de troco, e por isso o que
 * mais atrasa a fila quando o operador precisa procurar o botao.
 */
export const PAYMENT_ORDER: PaymentMethod[] = ['cash', 'credit', 'debit', 'pix', 'voucher', 'fiado']

/** Uma parcela do pagamento: forma + valor (+ nota entregue, se em especie). */
export interface PaymentSplit {
  id: string
  method: PaymentMethod
  amount: number
  /** Valor em especie entregue pelo cliente nesta parcela. */
  changeFor: number | null
}

export type OrderType = 'delivery' | 'balcao' | 'retirada'

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  balcao: 'Balcão',
  retirada: 'Retirada',
  delivery: 'Entrega',
}

// ─── Clientes ─────────────────────────────────────────────────────────────────

export interface Customer {
  id: string
  name: string
  phone: string
  address?: string
  neighborhood?: string
  city?: string
  ltv: string
  totalOrders: number
}

/** Pedido devolvido por `POST /api/orders`. */
export interface OrderResponse {
  id: string
  /** `String` no schema, nao numero: e um codigo como "0001". */
  orderNumber: string
  orderType: string
  totalAmount: string
  createdAt: string
  customer?: Customer | null
}

// ─── Formatacao ───────────────────────────────────────────────────────────────

/** Moeda em pt-BR. Centralizado para o PDV inteiro falar a mesma lingua. */
export function brl(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  })
}

/** Arredonda para centavos, evitando residuo de ponto flutuante nas somas. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100
}
