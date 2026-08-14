/**
 * Frente de caixa (PDV).
 *
 * Tela de operacao, nao de gestao: alvos de toque grandes, area de trabalho
 * clara (a cozinha e iluminada, e fundo escuro reflete) e o total sempre
 * visivel. Ela vive ao lado do menu recolhido, montada por `pages/App.tsx`.
 * As decisoes principais:
 *
 * 1. **Sem caixa aberto, sem venda.** O servidor recusa (`CASH_CLOSED`) e a tela
 *    tambem bloqueia antes de o operador montar a comanda inteira e descobrir no
 *    fim. Toda venda pertence a um turno identificado, senao o fechamento nao
 *    tem com o que comparar a gaveta.
 *
 * 2. **O servidor e a autoridade sobre o dinheiro.** Os totais daqui existem
 *    para o operador conferir com o cliente; quem calcula de verdade e a API. Por
 *    isso a taxa de entrega espelha `resolveDeliveryFee` do backend em vez de
 *    inventar a propria conta.
 *
 * 3. **Atalhos de teclado.** F2 busca, F4 fecha a venda, Esc limpa. Quem opera
 *    caixa o dia inteiro trabalha com a mao no teclado, nao no mouse.
 *
 * 4. **Falha de impressao nao invalida a venda.** O pedido ja esta salvo; o
 *    operador e avisado para reimprimir, em vez de a venda ser desfeita.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bike,
  CheckCircle2,
  Lock,
  LogOut,
  Menu,
  Printer,
  ShoppingBag,
  Store,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import { apiGet, apiPost, errorMessage } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useTenant } from '../context/TenantContext'
import { useCashRegister } from '../hooks/useCashRegister'
import { usePrinter } from '../hooks/usePrinter'
import { useRealtime } from '../hooks/useRealtime'

import { CartPanel } from './pdv/CartPanel'
import { ItemDialog } from './pdv/ItemDialog'
import { PaymentDialog } from './pdv/PaymentDialog'
import { ProductGrid } from './pdv/ProductGrid'
import {
  brl,
  lineTotal,
  newLineId,
  ORDER_TYPE_LABELS,
  productCategory,
  round2,
  type CartItem,
  type ChosenAddon,
  type ComboOption,
  type Customer,
  type OrderResponse,
  type OrderType,
  type PaymentMethod,
  type PaymentSplit,
  type Product,
} from './pdv/types'

interface PDVProps {
  /**
   * Abre a gaveta de navegacao no celular.
   *
   * O estado vive no shell (`pages/App.tsx`), que e quem desenha o `SideNav`.
   * No desktop o trilho recolhido ja esta a vista e este botao fica oculto.
   */
  onOpenMenu?: () => void
}

export function PDV({ onOpenMenu }: PDVProps) {
  const { activeTenant } = useTenant()
  const { user, logout, can } = useAuth()
  const { printKitchen, printDelivery } = usePrinter()
  const cash = useCashRegister()
  const { status: liveStatus } = useRealtime()

  // ── Catalogo ──────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [productsError, setProductsError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('Todos')

  // ── Comanda ───────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>([])
  const [orderType, setOrderType] = useState<OrderType>('balcao')
  const [discount, setDiscount] = useState(0)
  const [couponCode, setCouponCode] = useState('')
  const [cashbackToUse, setCashbackToUse] = useState(0)
  const [pointsToUse, setPointsToUse] = useState(0)
  const [benefitDiscount, setBenefitDiscount] = useState(0)
  const [applyingBenefits, setApplyingBenefits] = useState(false)
  const [orderNotes, setOrderNotes] = useState('')

  // ── Cliente e entrega ─────────────────────────────────────────────────────
  const [phone, setPhone] = useState('')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [searchingCustomer, setSearchingCustomer] = useState(false)
  const [deliveryZone, setDeliveryZone] = useState('')

  // ── Dialogos e envio ──────────────────────────────────────────────────────
  const [itemDialog, setItemDialog] = useState<{
    product: Product
    lineId: string | null
  } | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  /**
   * Forma de pagamento provavel, marcada no painel enquanto o pedido e montado.
   * Ela apenas ABRE o dialogo de fechamento na opcao certa; quem registra o
   * pagamento (e divide, e calcula troco) continua sendo o dialogo.
   */
  const [payMethod, setPayMethod] = useState<PaymentMethod>('pix')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [lastSale, setLastSale] = useState<{
    order: OrderResponse
    change: number
    printFailed: boolean
  } | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)

  // ── Carregar produtos ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeTenant) return
    let alive = true
    setLoadingProducts(true)
    setProductsError(null)

    apiGet<Product[]>('/api/products', { active: true })
      .then((list) => {
        if (!alive) return
        setProducts(Array.isArray(list) ? list.filter((p) => p.active) : [])
      })
      .catch((err) => {
        if (!alive) return
        setProductsError(errorMessage(err, 'Não foi possível carregar os produtos.'))
        setProducts([])
      })
      .finally(() => {
        if (alive) setLoadingProducts(false)
      })

    return () => {
      alive = false
    }
  }, [activeTenant])

  // ── Buscar cliente pelo telefone ──────────────────────────────────────────
  useEffect(() => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 8 || !activeTenant) {
      setCustomer(null)
      return
    }

    // Espera o operador parar de digitar: uma consulta por tecla geraria uma
    // rajada de requisicoes e o resultado poderia chegar fora de ordem.
    const timer = setTimeout(() => {
      let alive = true
      setSearchingCustomer(true)
      apiGet<Customer[]>('/api/customers', { phone: digits })
        .then((list) => {
          if (!alive) return
          const found = Array.isArray(list) ? (list[0] ?? null) : null
          setCustomer(found)
          // Preenche o bairro do cadastro: e o que define a taxa de entrega.
          if (found?.neighborhood) setDeliveryZone(found.neighborhood)
        })
        .catch(() => {
          if (alive) setCustomer(null)
        })
        .finally(() => {
          if (alive) setSearchingCustomer(false)
        })
      return () => {
        alive = false
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [phone, activeTenant])

  // ── Categorias e filtro ───────────────────────────────────────────────────
  const categories = useMemo(() => {
    const set = new Set(products.map(productCategory))
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [products])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products.filter((p) => {
      const matchCategory = activeCategory === 'Todos' || productCategory(p) === activeCategory
      // Busca tambem por SKU e codigo de barras: quem tem leitor aponta para o
      // produto e o codigo cai no campo de busca.
      const matchTerm =
        !term ||
        p.name.toLowerCase().includes(term) ||
        p.sku?.toLowerCase().includes(term) ||
        p.barcode?.toLowerCase().includes(term)
      return matchCategory && matchTerm
    })
  }, [products, activeCategory, search])

  // ── Totais ───────────────────────────────────────────────�����────────────────
  const subtotal = round2(cart.reduce((sum, item) => sum + lineTotal(item), 0))

  const zones = activeTenant?.deliveryZones ?? []
  const selectedZone =
    zones.find((z) => z.name.toLowerCase() === deliveryZone.trim().toLowerCase()) ?? null

  /**
   * Taxa de entrega, espelhando `resolveDeliveryFee` do backend: so incide em
   * entrega, e o bairro escolhido tem precedencia sobre a taxa base. Mostrar a
   * base quando o bairro tem taxa propria faria o operador cobrar a menos.
   */
  const deliveryFee =
    orderType !== 'delivery'
      ? 0
      : selectedZone
        ? Number(selectedZone.fee) || 0
        : Number(activeTenant?.deliveryFeeBase ?? 0) || 0

  const total = round2(Math.max(0, subtotal + deliveryFee - discount - benefitDiscount))

  async function applyBenefits() {
    setApplyingBenefits(true); setSubmitError(null)
    try {
      const quote = await apiPost<{ discount: number; couponCode: string | null }>('/api/customers/benefits/quote', { customerId: customer?.id ?? null, subtotal, couponCode: couponCode.trim() || null, cashbackToUse, pointsToUse })
      setBenefitDiscount(Number(quote.discount)); if (quote.couponCode) setCouponCode(quote.couponCode)
    } catch (err) { setBenefitDiscount(0); setSubmitError(errorMessage(err, 'Não foi possível aplicar o benefício.')) }
    finally { setApplyingBenefits(false) }
  }

  // ── Manipular a comanda ───────────────────────────────────────────────────

  /**
   * Ao tocar num produto: se ele tem proteina ou adicionais, abre o dialogo de
   * montagem. Sem opcoes, entra direto na comanda — um toque, um item.
   */
  const pickProduct = useCallback((product: Product) => {
    const needsDialog =
      (product.comboOptions?.length ?? 0) > 0 || (product.addons?.length ?? 0) > 0

    if (needsDialog) {
      setItemDialog({ product, lineId: null })
      return
    }

    setCart((prev) => {
      // Mesmo produto sem observacao e sem adicionais: soma na linha existente
      // em vez de repetir. A comanda com "Coca × 3" e mais legivel que tres
      // linhas iguais, tanto na tela quanto na impressao.
      const existing = prev.find(
        (i) =>
          i.product.id === product.id &&
          !i.observations &&
          i.addons.length === 0 &&
          !i.selectedProtein,
      )
      if (existing) {
        return prev.map((i) =>
          i.lineId === existing.lineId ? { ...i, quantity: i.quantity + 1 } : i,
        )
      }
      return [
        ...prev,
        {
          lineId: newLineId(),
          product,
          quantity: 1,
          observations: '',
          selectedProtein: null,
          addons: [],
        },
      ]
    })
  }, [])

  function confirmItem(result: {
    quantity: number
    observations: string
    selectedProtein: ComboOption | null
    addons: ChosenAddon[]
  }) {
    if (!itemDialog) return
    const { product, lineId } = itemDialog

    setCart((prev) => {
      if (lineId) {
        return prev.map((i) => (i.lineId === lineId ? { ...i, ...result } : i))
      }
      return [...prev, { lineId: newLineId(), product, ...result }]
    })
    setItemDialog(null)
  }

  function changeQuantity(lineId: string, delta: number) {
    setCart((prev) =>
      prev.flatMap((item) => {
        if (item.lineId !== lineId) return [item]
        const next = item.quantity + delta
        // Chegar a zero remove a linha: e o gesto esperado de quem aperta "−"
        // repetidamente para tirar o item.
        return next <= 0 ? [] : [{ ...item, quantity: next }]
      }),
    )
  }

  const resetSale = useCallback(() => {
    setCart([])
    setDiscount(0)
    setCouponCode(''); setCashbackToUse(0); setPointsToUse(0); setBenefitDiscount(0)
    setOrderNotes('')
    setPhone('')
    setCustomer(null)
    setDeliveryZone('')
    setSubmitError(null)
  }, [])

  // ── Fechar a venda ────────────────────────────────────────────────────────
  async function submitSale(splits: PaymentSplit[]) {
    if (cart.length === 0) return
    setSubmitting(true)
    setSubmitError(null)

    const payload = {
      items: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        observations: item.observations || null,
        selectedProteinId: item.selectedProtein?.ingredientId || null,
        selectedProteinName: item.selectedProtein?.label || null,
        // Os adicionais agora sao enviados: o backend ja sabia valida-los e
        // congelar nome e preco, mas o PDV nunca os mandava — o cliente pagava
        // o bacon extra que nunca chegava na cozinha.
        addons: item.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
      })),
      customerId: customer?.id ?? null,
      orderType,
      // Pagamento misto: uma entrada por forma usada.
      payments: splits.map((s) => ({
        method: s.method,
        amount: round2(s.amount),
        changeFor: s.method === 'cash' && s.changeFor != null ? round2(s.changeFor) : null,
      })),
      discount,
      couponCode: couponCode.trim() || null,
      cashbackToUse,
      pointsToUse,
      deliveryZone: orderType === 'delivery' ? deliveryZone.trim() || null : null,
      observations: orderNotes.trim() || null,
    }

    try {
      const order = await apiPost<OrderResponse>('/api/orders', payload)

      // Troco a mostrar na confirmacao: so a parcela em especie gera troco.
      const cashSplit = splits.find((s) => s.method === 'cash')
      const change =
        cashSplit?.changeFor != null ? round2(Math.max(0, cashSplit.changeFor - cashSplit.amount)) : 0

      // ── Impressao ────────────────────────────────────────────────────────
      const printItems = cart.map((item) => ({
        productName: item.product.name,
        quantity: item.quantity,
        observations: item.observations || undefined,
        selectedProteinName: item.selectedProtein?.label || undefined,
        // Os adicionais precisam sair na comanda da cozinha, senao o bacon
        // extra e cobrado e nao e produzido.
        addons: item.addons.map((a) => ({ name: a.name, quantity: a.quantity })),
      }))

      const kitchen = await printKitchen({
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        items: printItems,
        observations: orderNotes || undefined,
        createdAt: order.createdAt,
      })

      let delivery: { success: boolean } = { success: true }
      if (orderType === 'delivery') {
        const target = customer ?? order.customer
        delivery = await printDelivery({
          orderNumber: order.orderNumber,
          customerName: target?.name || 'Balcão',
          customerPhone: target?.phone || '',
          address: target?.address || '',
          items: printItems,
          // Total do SERVIDOR: ele e a autoridade, e essa via vai na mao do
          // entregador receber o dinheiro.
          totalAmount: Number(order.totalAmount) || total,
          deliveryFee,
          paymentMethod: splits[0]?.method ?? 'cash',
          observations: orderNotes || undefined,
          createdAt: order.createdAt,
        })
      }

      setLastSale({
        order,
        change,
        printFailed: !kitchen.success || !delivery.success,
      })
      setPayOpen(false)
      resetSale()
      // O turno mudou (entrou venda): atualiza o resumo do caixa no topo.
      void cash.reload()
    } catch (err) {
      setSubmitError(errorMessage(err, 'Não foi possível registrar a venda.'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Atalhos de teclado ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Nao sequestra o teclado enquanto um dialogo esta aberto: ali o Esc e o
      // Enter pertencem ao dialogo.
      if (itemDialog || payOpen) return

      if (event.key === 'F2') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
        return
      }
      if (event.key === 'F4') {
        event.preventDefault()
        if (cart.length > 0 && cash.isOpen) setPayOpen(true)
        return
      }
      if (event.key === 'Escape') {
        // Esc no campo de busca limpa a busca; fora dele, fecha a confirmacao.
        if (document.activeElement === searchRef.current && search) {
          setSearch('')
          return
        }
        setLastSale(null)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cart.length, cash.isOpen, itemDialog, payOpen, search])

  // ── Estados de bloqueio ───────────���───────────────────────────────────────

  const editingItem = itemDialog?.lineId
    ? (cart.find((i) => i.lineId === itemDialog.lineId) ?? null)
    : null

  return (
    // `h-full`, e nao `h-screen`: o shell em `pages/App.tsx` ja define a altura
    // da janela: repetir `h-screen` aqui somaria a altura do menu e criaria uma
    // barra de rolagem na pagina inteira — justamente o que o PDV nao pode ter,
    // porque grade e comanda rolam por dentro.
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas">
      {/* ── Barra superior ─────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5">
        {/* Gaveta de navegacao no celular, onde o trilho lateral nao cabe. */}
        {onOpenMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Abrir menu"
            className="-ml-1 rounded-md p-1.5 text-slate transition-colors hover:bg-canvas hover:text-ink lg:hidden"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
        )}

        {/* O nome da loja ja aparece no menu ao lado; repeti-lo aqui gastaria a
            melhor area da barra com a informacao que o operador menos consulta.
            Aqui fica a trilha (onde estou) e quem esta logado — isso importa
            quando o turno troca no meio do dia. O titulo grande e as abas de
            tipo de pedido descem para a area de trabalho: sao decisoes DO
            PEDIDO, nao da navegacao. */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-display text-base leading-tight text-plum">PDV</span>
          <span aria-hidden="true" className="text-line">
            /
          </span>
          <span className="truncate text-sm text-slate">
            {user?.firstName} {user?.lastName}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Conexao em tempo real: se cair, o operador precisa saber */}
          <span
            title={liveStatus === 'connected' ? 'Conectado' : 'Sem conexão em tempo real'}
            className="flex items-center gap-1.5 text-xs font-medium"
          >
            {liveStatus === 'connected' ? (
              <Wifi aria-hidden="true" className="h-3.5 w-3.5 text-good" />
            ) : (
              <WifiOff aria-hidden="true" className="h-3.5 w-3.5 text-warn" />
            )}
            <span className="sr-only">
              {liveStatus === 'connected' ? 'Conectado' : 'Sem conexão'}
            </span>
          </span>

          {/* Estado do caixa: a informacao que decide se ha venda ou nao */}
          {cash.isOpen ? (
            <Link
              to="/caixa"
              className="flex items-center gap-2 rounded-md bg-good-soft px-2.5 py-1.5 text-xs font-semibold text-good transition-colors hover:brightness-95"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-good" aria-hidden="true" />
              Caixa aberto
              {cash.summary && (
                <span className="tabular-nums opacity-80">{brl(cash.summary.expectedCash)}</span>
              )}
            </Link>
          ) : (
            <span className="flex items-center gap-1.5 rounded-md bg-bad-soft px-2.5 py-1.5 text-xs font-semibold text-bad">
              <Lock aria-hidden="true" className="h-3 w-3" />
              Caixa fechado
            </span>
          )}

          <button
            type="button"
            onClick={logout}
            aria-label="Sair do sistema"
            title="Sair"
            className="rounded-md p-1.5 text-slate transition-colors hover:bg-canvas hover:text-ink"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── Corpo ──────────────────────────────────────────────────────── */}
      {!cash.isOpen && !cash.isLoading ? (
        // Bloqueio: sem turno aberto nao ha venda. Avisar aqui, antes de o
        // operador montar a comanda, evita o trabalho perdido.
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-bad-soft"
            >
              <Lock className="h-6 w-6 text-bad" />
            </span>
            <div>
              <h2 className="font-display text-xl text-plum">O caixa está fechado</h2>
              <p className="mt-1.5 text-sm text-slate">
                Toda venda precisa pertencer a um turno de caixa, para que o fechamento confira
                com o dinheiro na gaveta. Abra o caixa para começar a vender.
              </p>
            </div>
            {can('cash:operate') ? (
              <Link
                to="/caixa"
                className="rounded-lg bg-brand px-5 py-3 text-sm font-bold text-brand-ink transition-colors hover:bg-brand-strong"
              >
                Abrir o caixa
              </Link>
            ) : (
              <p className="text-xs text-slate">
                Peça ao gerente para abrir o caixa: seu acesso não permite esta ação.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Produtos */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {productsError && (
              <p
                role="alert"
                className="flex items-center gap-2 bg-bad/15 px-4 py-2.5 text-sm font-medium text-bad"
              >
                <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
                {productsError}
              </p>
            )}

            {/* Titulo e tipo de pedido: o inicio da folha de trabalho.
                O tipo vem ANTES da busca de proposito — ele muda o total (taxa
                de entrega) e o que a comanda imprime, entao e a primeira
                pergunta do atendimento, nao um ajuste de ultima hora. */}
            <div className="shrink-0 px-6 pt-5 pb-4">
              <h1 className="font-display text-3xl leading-none text-plum">Novo pedido</h1>

              <div
                role="group"
                aria-label="Tipo de pedido"
                className="mt-4 flex gap-1 rounded-xl border border-line bg-surface p-1 shadow-sm sm:max-w-xl"
              >
                {(['delivery', 'retirada', 'balcao'] as OrderType[]).map((type) => {
                  const active = orderType === type
                  const Icon =
                    type === 'delivery' ? Bike : type === 'retirada' ? ShoppingBag : Store
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setOrderType(type)}
                      aria-pressed={active}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                        active ? 'bg-plum text-cream' : 'text-slate hover:bg-canvas hover:text-ink'
                      }`}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4" />
                      {ORDER_TYPE_LABELS[type]}
                    </button>
                  )
                })}
              </div>
            </div>

            <ProductGrid
              products={filtered}
              categories={categories}
              activeCategory={activeCategory}
              search={search}
              loading={loadingProducts}
              onSearchChange={setSearch}
              onCategoryChange={setActiveCategory}
              onPick={pickProduct}
              searchRef={searchRef}
            />

          </div>

          {/* Pedido: cliente, entrega, itens, totais e fechamento */}
          <CartPanel
            items={cart}
            subtotal={subtotal}
            deliveryFee={deliveryFee}
            discount={discount}
            total={total}
            disabled={!cash.isOpen}
            orderType={orderType}
            phone={phone}
            onPhoneChange={setPhone}
            customer={customer}
            searchingCustomer={searchingCustomer}
            zones={zones}
            deliveryFeeBase={Number(activeTenant?.deliveryFeeBase ?? 0)}
            deliveryZone={deliveryZone}
            onDeliveryZoneChange={setDeliveryZone}
            notes={orderNotes}
            onNotesChange={setOrderNotes}
            onDiscountChange={setDiscount}
            couponCode={couponCode}
            onCouponCodeChange={(value) => { setCouponCode(value); setBenefitDiscount(0) }}
            cashbackToUse={cashbackToUse}
            onCashbackToUseChange={(value) => { setCashbackToUse(value); setBenefitDiscount(0) }}
            pointsToUse={pointsToUse}
            onPointsToUseChange={(value) => { setPointsToUse(value); setBenefitDiscount(0) }}
            couponsEnabled={Boolean(activeTenant?.couponsEnabled)}
            cashbackEnabled={Boolean(activeTenant?.cashbackEnabled)}
            loyaltyPointsEnabled={Boolean(activeTenant?.loyaltyPointsEnabled)}
            benefitDiscount={benefitDiscount}
            onApplyBenefits={() => void applyBenefits()}
            applyingBenefits={applyingBenefits}
            method={payMethod}
            onMethodChange={setPayMethod}
            onChangeQuantity={changeQuantity}
            onRemove={(lineId) => setCart((prev) => prev.filter((i) => i.lineId !== lineId))}
            onEdit={(lineId) => {
              const item = cart.find((i) => i.lineId === lineId)
              if (item) setItemDialog({ product: item.product, lineId })
            }}
            onClear={resetSale}
            onCheckout={() => setPayOpen(true)}
          />
        </div>
      )}

      {/* ── Dialogos ───────────────────────────────────────────────────── */}
      {itemDialog && (
        <ItemDialog
          product={itemDialog.product}
          initial={
            editingItem
              ? {
                  quantity: editingItem.quantity,
                  observations: editingItem.observations,
                  selectedProtein: editingItem.selectedProtein,
                  addons: editingItem.addons,
                }
              : undefined
          }
          onCancel={() => setItemDialog(null)}
          onConfirm={confirmItem}
        />
      )}

      {payOpen && (
        <PaymentDialog
          total={total}
          submitting={submitting}
          error={submitError}
          initialMethod={payMethod}
          onCancel={() => {
            setPayOpen(false)
            setSubmitError(null)
          }}
          onConfirm={submitSale}
        />
      )}

      {/* Confirmacao da venda */}
      {lastSale && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="done-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-plum/85 p-6 backdrop-blur-sm"
        >
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl bg-surface p-6 text-center shadow-2xl">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-good-soft"
            >
              <CheckCircle2 className="h-7 w-7 text-good" />
            </span>
            <div>
              <h2 id="done-title" className="font-display text-xl text-plum">
                Venda registrada
              </h2>
              <p className="mt-1 text-sm text-slate">
                Pedido{' '}
                <span className="font-semibold tabular-nums">#{lastSale.order.orderNumber}</span> ·{' '}
                {brl(Number(lastSale.order.totalAmount) || 0)}
              </p>
            </div>

            {/* Troco em destaque: e a ultima coisa que falta fazer. Em bronze
                (`text-accent`), nao no dourado da marca: dourado sobre o creme
                do bloco nao alcanca contraste de leitura, e este e um numero
                que precisa ser conferido nota a nota. */}
            {lastSale.change > 0 && (
              <div className="w-full rounded-card bg-brand-soft px-4 py-3">
                <p className="text-xs font-semibold tracking-wide text-accent uppercase">
                  Troco a devolver
                </p>
                <p className="font-display text-3xl tabular-nums text-plum">
                  {brl(lastSale.change)}
                </p>
              </div>
            )}

            {lastSale.printFailed && (
              <p className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-xs font-medium text-warn">
                <Printer aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                A venda foi salva, mas a impressão falhou. Reimprima pela tela de pedidos.
              </p>
            )}

            <button
              type="button"
              onClick={() => setLastSale(null)}
              autoFocus
              className="w-full rounded-lg bg-brand py-3 text-base font-bold text-brand-ink transition-colors hover:bg-brand-strong"
            >
              Nova venda
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
