/**
 * Painel do pedido: cliente, entrega, itens, totais e o fechamento.
 *
 * O total fica grande de proposito. E o numero que o operador fala em voz alta
 * para o cliente e o que ele confere antes de receber; um total pequeno, no meio
 * de outros textos do mesmo tamanho, e lido errado.
 *
 * Cada linha mostra proteina, adicionais e observacao porque a conferencia
 * acontece aqui — depois de imprimir, corrigir custa uma comanda nova.
 *
 * ── Por que cliente e entrega vivem AQUI ─────────────────────────────────────
 * Antes eles ficavam numa barra sob a grade de produtos, e isso partia o pedido
 * em dois lugares: o operador montava a comanda a direita, mas o telefone e o
 * bairro — que MUDAM O TOTAL, via taxa de entrega — ficavam do outro lado da
 * tela, fora do campo de visao de quem confere o valor. Reunir tudo na mesma
 * coluna deixa "o pedido" ser um objeto unico: quem e, para onde vai, o que
 * leva, quanto da. A grade a esquerda volta a ser so catalogo.
 *
 * ── Por que o painel e claro ─────────────────────────────────────────────────
 * Ele era escuro (`bg-ink-soft`) quando o PDV inteiro era escuro. Com a area de
 * trabalho em creme, manter a comanda escura criaria um bloco pesado na borda da
 * tela e romperia a leitura continua produto → pedido. O peso visual passou a
 * vir da folha branca elevada sobre o creme, nao da cor.
 */

import {
  Banknote,
  ChevronDown,
  CreditCard,
  MapPin,
  Minus,
  Pencil,
  Plus,
  QrCode,
  ShoppingCart,
  Trash2,
  User,
} from 'lucide-react'

import type { DeliveryZone } from '../../context/AuthContext'
import {
  brl,
  lineTotal,
  tintFor,
  type CartItem,
  type Customer,
  type OrderType,
  type PaymentMethod,
} from './types'

interface Props {
  items: CartItem[]
  subtotal: number
  deliveryFee: number
  discount: number
  total: number
  disabled: boolean

  /** Define se o bloco de entrega aparece e se a taxa incide. */
  orderType: OrderType

  phone: string
  onPhoneChange: (value: string) => void
  customer: Customer | null
  searchingCustomer: boolean

  zones: DeliveryZone[]
  deliveryFeeBase: number
  deliveryZone: string
  onDeliveryZoneChange: (value: string) => void

  notes: string
  onNotesChange: (value: string) => void
  onDiscountChange: (value: number) => void

  /**
   * Forma de pagamento provavel. E um ATALHO, nao a decisao final: o dialogo de
   * fechamento abre com ela pre-selecionada e continua sendo o lugar onde se
   * divide o pagamento e se calcula troco.
   */
  method: PaymentMethod
  onMethodChange: (method: PaymentMethod) => void

  onChangeQuantity: (lineId: string, delta: number) => void
  onRemove: (lineId: string) => void
  onEdit: (lineId: string) => void
  onClear: () => void
  onCheckout: () => void
}

/** Os tres atalhos que resolvem quase toda venda. O resto vive no dialogo. */
const METHOD_SHORTCUTS: { method: PaymentMethod; label: string; Icon: typeof QrCode }[] = [
  { method: 'pix', label: 'Pix', Icon: QrCode },
  { method: 'credit', label: 'Cartão', Icon: CreditCard },
  { method: 'cash', label: 'Dinheiro', Icon: Banknote },
]

export function CartPanel({
  items,
  subtotal,
  deliveryFee,
  discount,
  total,
  disabled,
  orderType,
  phone,
  onPhoneChange,
  customer,
  searchingCustomer,
  zones,
  deliveryFeeBase,
  deliveryZone,
  onDeliveryZoneChange,
  notes,
  onNotesChange,
  onDiscountChange,
  method,
  onMethodChange,
  onChangeQuantity,
  onRemove,
  onEdit,
  onClear,
  onCheckout,
}: Props) {
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0)
  const typedPhone = phone.replace(/\D/g, '').length >= 8

  const fieldClass =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-slate focus:border-brand focus:outline-none'
  const labelClass = 'text-[0.6875rem] font-semibold tracking-wide text-slate uppercase'
  /**
   * O `<select>` nativo desenha a propria seta e ignora a altura que damos ao
   * campo, o que o deixava mais baixo e mais cinza que os vizinhos. O
   * `appearance-none` devolve a caixa ao tema; a seta volta como icone
   * posicionado, e o `pr-9` reserva o espaco dela para o nome do bairro nao
   * passar por baixo.
   */
  const selectClass = `${fieldClass} cursor-pointer appearance-none pr-9`

  /**
   * No estreito (tablet retrato) o painel empilha sob a grade e disputa a altura
   * com ela. O teto e menor com o pedido vazio (`45svh`) e maior depois que ha
   * itens (`60svh`): antes do primeiro toque o que importa e ver o catalogo;
   * durante a conferencia, o pedido. Em `lg` ele volta a ser coluna inteira e o
   * teto sai de cena.
   */
  const heightClass = items.length === 0 ? 'max-h-[45svh]' : 'max-h-[60svh]'

  return (
    <section
      aria-label="Pedido"
      className={`flex ${heightClass} w-full min-w-0 shrink-0 flex-col overflow-hidden border-t border-line bg-surface lg:m-4 lg:ml-0 lg:max-h-none lg:w-[24rem] lg:rounded-card lg:border lg:shadow-sm xl:w-[26rem]`}
    >
      {/* ── Cabecalho ── */}
      <header className="flex shrink-0 items-center justify-between gap-3 px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <ShoppingCart aria-hidden="true" className="h-4.5 w-4.5 text-accent" />
          <h2 className="font-display text-lg text-plum">Pedido</h2>
          {itemCount > 0 && (
            <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold tabular-nums text-brand-ink">
              {itemCount}
            </span>
          )}
        </div>
        {items.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-medium text-slate transition-colors hover:text-bad"
          >
            Limpar
          </button>
        )}
      </header>

      {/* ── Rolagem: cliente, entrega e itens ──
          Tudo o que cresce fica junto num unico trecho rolavel, para os totais e
          o botao de fechar nunca sairem da tela. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Cliente */}
        <div className="flex flex-col gap-1.5 px-5 pb-4">
          <label className={labelClass} htmlFor="pdv-phone">
            Cliente
          </label>
          <div className="relative">
            <User
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate"
            />
            <input
              id="pdv-phone"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
              placeholder="Telefone (opcional)"
              className={`${fieldClass} pl-9 tabular-nums`}
            />
          </div>

          {searchingCustomer ? (
            <p className="text-xs text-slate">Procurando...</p>
          ) : customer ? (
            <p className="text-xs text-slate">
              <span className="font-semibold text-ink">{customer.name}</span> ·{' '}
              {customer.totalOrders} pedido{customer.totalOrders === 1 ? '' : 's'}
              {customer.neighborhood && ` · ${customer.neighborhood}`}
            </p>
          ) : typedPhone ? (
            <p className="text-xs text-warn">Cliente novo (não cadastrado)</p>
          ) : null}
        </div>

        {/* Entrega: so em delivery, porque so ali existe taxa e endereco */}
        {orderType === 'delivery' && (
          <div className="flex flex-col gap-1.5 px-5 pb-4">
            <label className={labelClass} htmlFor="pdv-zone">
              Endereço de entrega
            </label>

            {customer?.address && (
              <p className="flex items-start gap-2 rounded-lg bg-canvas px-3 py-2 text-xs leading-relaxed text-ink">
                <MapPin aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <span>
                  {customer.address}
                  {customer.city && (
                    <span className="block text-slate">
                      {customer.neighborhood ? `${customer.neighborhood} · ` : ''}
                      {customer.city}
                    </span>
                  )}
                </span>
              </p>
            )}

            {/* O bairro e o que define a taxa: fica sempre visivel, com o valor
                ao lado do nome, para o operador nao cobrar a menos. */}
            {zones.length > 0 ? (
              <div className="relative">
                <select
                  id="pdv-zone"
                  value={deliveryZone}
                  onChange={(e) => onDeliveryZoneChange(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Taxa base · {brl(deliveryFeeBase)}</option>
                  {zones.map((zone) => (
                    <option key={zone.name} value={zone.name}>
                      {zone.name} · {brl(Number(zone.fee) || 0)}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate"
                />
              </div>
            ) : (
              <input
                id="pdv-zone"
                type="text"
                value={deliveryZone}
                onChange={(e) => onDeliveryZoneChange(e.target.value)}
                placeholder="Bairro (nenhum cadastrado)"
                className={fieldClass}
              />
            )}
          </div>
        )}

        {/* Itens. O estado vazio tem folga menor no estreito, onde cada linha de
            altura do painel sai da grade de produtos. */}
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 border-t border-line px-6 py-8 text-center lg:py-14">
            <ShoppingCart aria-hidden="true" className="h-8 w-8 text-line" />
            <p className="text-sm font-medium text-slate">Nenhum item ainda</p>
            <p className="text-xs text-slate/70">Toque nos produtos para montar o pedido.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {items.map((item) => {
              const image = item.product.imageUrl?.trim()
              return (
                <li key={item.lineId} className="flex gap-3 px-5 py-3.5">
                  {/* Miniatura: a mesma cor/foto da grade, para o operador
                      reconhecer a linha sem reler o nome. */}
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg">
                    {image ? (
                      <img
                        src={image || '/placeholder.svg'}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className={`flex h-full w-full items-center justify-center ${tintFor(item.product.name)}`}
                      >
                        <span className="font-display text-base leading-none opacity-70">
                          {item.product.name.trim().charAt(0).toUpperCase() || '?'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm leading-snug font-semibold text-ink">
                        {item.product.name}
                      </p>
                      <span className="shrink-0 text-sm font-bold tabular-nums text-ink">
                        {brl(lineTotal(item))}
                      </span>
                    </div>

                    {/* Proteina escolhida */}
                    {item.selectedProtein && (
                      <p className="mt-0.5 text-xs text-slate">{item.selectedProtein.label}</p>
                    )}

                    {/* Adicionais, com o preco de cada um */}
                    {item.addons.length > 0 && (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {item.addons.map((addon) => (
                          <li key={addon.addonId} className="text-xs text-accent">
                            + {addon.quantity > 1 && `${addon.quantity}× `}
                            {addon.name}
                            <span className="ml-1 tabular-nums text-slate">
                              {brl(addon.price * addon.quantity)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Observacao da cozinha */}
                    {item.observations && (
                      <p className="mt-1 rounded bg-warn-soft px-1.5 py-0.5 text-xs text-warn">
                        {item.observations}
                      </p>
                    )}

                    {/* Controles da linha */}
                    <div className="mt-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onChangeQuantity(item.lineId, -1)}
                        aria-label={`Diminuir ${item.product.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink transition-colors hover:bg-canvas"
                      >
                        <Minus aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-8 text-center text-sm font-bold tabular-nums text-ink">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => onChangeQuantity(item.lineId, 1)}
                        aria-label={`Aumentar ${item.product.name}`}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-line text-ink transition-colors hover:bg-canvas"
                      >
                        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>

                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEdit(item.lineId)}
                          aria-label={`Editar ${item.product.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-slate transition-colors hover:bg-canvas hover:text-ink"
                        >
                          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemove(item.lineId)}
                          aria-label={`Remover ${item.product.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-slate transition-colors hover:bg-bad-soft hover:text-bad"
                        >
                          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* ── Observacao, desconto, totais e fechamento ──
          Fixo no pe do painel: o total e o botao nunca rolam para fora. */}
      <footer className="shrink-0 border-t border-line bg-canvas px-5 py-4">
        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={labelClass}>Observações</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="Ex: sem calda"
              className={fieldClass}
            />
          </label>
          <label className="flex w-24 shrink-0 flex-col gap-1">
            <span className={labelClass}>Desconto</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={discount || ''}
              onChange={(e) => onDiscountChange(Math.max(0, Number(e.target.value)))}
              placeholder="0,00"
              className={`${fieldClass} tabular-nums`}
            />
          </label>
        </div>

        <dl className="mt-4 flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate">Subtotal</dt>
            <dd className="tabular-nums text-ink">{brl(subtotal)}</dd>
          </div>
          {deliveryFee > 0 && (
            <div className="flex justify-between">
              <dt className="text-slate">Taxa de entrega</dt>
              <dd className="tabular-nums text-ink">{brl(deliveryFee)}</dd>
            </div>
          )}
          {discount > 0 && (
            <div className="flex justify-between">
              <dt className="text-good">Desconto</dt>
              <dd className="tabular-nums text-good">− {brl(discount)}</dd>
            </div>
          )}
          <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2.5">
            <dt className="font-display text-lg text-plum">Total</dt>
            {/* O numero que o operador fala em voz alta. */}
            <dd className="font-display text-[1.75rem] leading-none tabular-nums text-plum">
              {brl(total)}
            </dd>
          </div>
        </dl>

        {/* Forma de pagamento provavel */}
        <div className="mt-3.5">
          <span className={labelClass}>Forma de pagamento</span>
          <div role="group" aria-label="Forma de pagamento" className="mt-1.5 flex gap-2">
            {METHOD_SHORTCUTS.map(({ method: value, label, Icon }) => {
              const active = method === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onMethodChange(value)}
                  aria-pressed={active}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'border-plum bg-plum text-cream'
                      : 'border-line bg-surface text-slate hover:border-brand hover:text-ink'
                  }`}
                >
                  <Icon aria-hidden="true" className="h-4 w-4" />
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Vinho sobre dourado: ver a nota de contraste em index.css. */}
        <button
          type="button"
          onClick={onCheckout}
          disabled={disabled || items.length === 0}
          className="mt-3.5 w-full rounded-lg bg-brand py-3.5 text-base font-bold text-brand-ink transition-colors hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-slate"
        >
          Finalizar pedido
          <span className="ml-2 text-sm font-medium opacity-60">F4</span>
        </button>
      </footer>
    </section>
  )
}
