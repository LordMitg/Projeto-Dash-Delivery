import React, { useState, useEffect, useCallback } from 'react';
import { useTenant } from '../context/TenantContext';
import { usePrinter } from '../hooks/usePrinter';
import type { PrintKitchenPayload, PrintDeliveryPayload } from '../hooks/usePrinter';
import { apiGet, apiPost, errorMessage } from '../lib/api';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  sku: string;
  price: string;
  category: string | null;
  /**
   * A categoria de verdade vem da relacao `menuCategory`; o campo `category`
   * e um texto legado que hoje chega nulo. As abas do PDV usam menuCategory
   * primeiro, senao toda a grade caia em "Outros".
   */
  menuCategory?: { id: string; name: string } | null;
  productType: string;
  comboOptions: ComboOption[] | null;
  active: boolean;
}

interface ComboOption {
  group: string;
  label: string;
  ingredientId: string;
}

interface CartItem {
  product: Product;
  quantity: number;
  observations: string;
  selectedProtein: ComboOption | null;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  /** Bairro salvo no cadastro: define a taxa de entrega. */
  neighborhood?: string;
  city?: string;
  ltv: string;
  totalOrders: number;
}

/** Pedido retornado por `POST /api/orders`. */
interface OrderResponse {
  id: string;
  /** `String` no schema do Prisma, nao numero: e um codigo como "0001". */
  orderNumber: string;
  orderType: string;
  totalAmount: string;
  createdAt: string;
  customer?: Customer | null;
}

type PaymentMethod = 'cash' | 'credit' | 'debit' | 'pix' | 'voucher';
type OrderType = 'delivery' | 'balcao';

// ─── Constantes ───────────────────────────────────────────────────────────────

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  credit: 'Credito',
  debit: 'Debito',
  pix: 'PIX',
  voucher: 'Vale',
};

const CATEGORY_COLORS: Record<string, string> = {
  'Proteina': '#e74c3c',
  'Acompanhamento': '#27ae60',
  'Bebida': '#2980b9',
  'Sobremesa': '#8e44ad',
  'Combo': '#e67e22',
};

// ─── Componente Principal ─────────────────────────────────────────────────────

/** Categoria exibida nas abas: relacao primeiro, texto legado depois. */
function productCategory(p: Product): string {
  return p.menuCategory?.name || p.category || 'Outros';
}

export function PDV() {
  const { activeTenant } = useTenant();
  const { printKitchen, printDelivery, paperWidth } = usePrinter();

  // Catálogo
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('Todos');
  const [search, setSearch] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  // Incrementado pelo "Tentar de novo": entra nas deps do efeito de catalogo.
  const [reloadKey, setReloadKey] = useState(0);

  // Carrinho
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('delivery');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [discount, setDiscount] = useState(0);
  const [orderObservations, setOrderObservations] = useState('');

  // Cliente
  const [customerSearch, setCustomerSearch] = useState('');
  const [foundCustomer, setFoundCustomer] = useState<Customer | null>(null);
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: '',
    phone: '',
    address: '',
    neighborhood: '',
    city: '',
  });
  /** Bairro do pedido: define a taxa de entrega cobrada pelo servidor. */
  const [deliveryZone, setDeliveryZone] = useState('');
  const [customerMode, setCustomerMode] = useState<'search' | 'new' | 'found'>('search');

  // Modais
  const [comboModal, setComboModal] = useState<{ product: Product; cartIndex: number | null } | null>(null);
  const [checkoutModal, setCheckoutModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Tipado: era `any`, o que deixava passar `data.order.orderNumber` mesmo
  // depois de a API ter mudado o formato da resposta.
  const [lastOrder, setLastOrder] = useState<OrderResponse | null>(null);
  const [successModal, setSuccessModal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [printWarning, setPrintWarning] = useState<string | null>(null);
  const [lastPrint, setLastPrint] = useState<{
    kitchen: PrintKitchenPayload;
    delivery: PrintDeliveryPayload | null;
  } | null>(null);

  // ── Carregar produtos ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeTenant) return;

    let cancelled = false;
    setLoadingProducts(true);
    setProductsError(null);

    // `apiGet` em vez de `fetch` cru: a API responde no envelope
    // `{ success, data }`, e o codigo antigo lia `data.products` — uma chave
    // que nunca existiu. A grade ficava vazia com o catalogo cheio, e sem
    // `catch` a falha era silenciosa. O helper desempacota e injeta o token.
    // O prefixo `/api` e obrigatorio: e o caminho que o proxy do Vite
    // encaminha para o backend. Sem ele o Vite devolve o index.html e o
    // catalogo fica vazio sem nenhum erro aparecer.
    apiGet<Product[]>('/api/products', { active: true })
      .then((list) => {
        if (cancelled) return;
        const items = Array.isArray(list) ? list : [];
        setProducts(items);
        const cats = Array.from(
          new Set(items.map((p) => productCategory(p)).filter(Boolean)),
        );
        setCategories(['Todos', ...cats]);
      })
      .catch((err) => {
        if (cancelled) return;
        setProductsError(errorMessage(err, 'Nao foi possivel carregar o catalogo.'));
        setProducts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTenant, reloadKey]);

  // ── Buscar cliente por telefone ───────────────────────────────────────────
  const searchCustomer = useCallback(
    async (phone: string) => {
      if (phone.length < 8 || !activeTenant) return;
      try {
        // Mesma correcao do catalogo: o token vive em `delivery_erp_token`, nao
        // em `token`, entao este fetch ia sem Authorization e voltava 401 —
        // silenciosamente, porque o `if (res.ok)` engolia a falha e o operador
        // via o formulario de "novo cliente" mesmo para quem ja era cadastrado.
        const list = await apiGet<Customer[]>('/api/customers', { phone });
        const found = Array.isArray(list) ? list[0] : undefined;
        if (found) {
          setFoundCustomer(found);
          setCustomerMode('found');
          // Cliente conhecido ja traz o bairro: aplica a taxa dele sem o
          // operador precisar reinformar (e sem risco de escolher outro).
          if (found.neighborhood) setDeliveryZone(found.neighborhood);
          return;
        }
      } catch {
        // Falha de busca nao pode travar a venda: cai no cadastro manual.
      }
      setFoundCustomer(null);
      setNewCustomerForm((f) => ({ ...f, phone }));
      setCustomerMode('new');
    },
    [activeTenant]
  );

  // ── Gerenciar carrinho ────────────────────────────────────────────────────

  function addToCart(product: Product) {
    if (product.productType === 'combo' && product.comboOptions?.length) {
      setComboModal({ product, cartIndex: null });
      return;
    }
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.product.id === product.id && !i.observations);
      const existing = idx >= 0 ? prev[idx] : undefined;
      if (existing) {
        const next = [...prev];
        next[idx] = { ...existing, quantity: existing.quantity + 1 };
        return next;
      }
      return [...prev, { product, quantity: 1, observations: '', selectedProtein: null }];
    });
  }

  function updateQty(idx: number, delta: number) {
    setCart((prev) => {
      const target = prev[idx];
      if (!target) return prev;
      const next = [...prev];
      const newQty = target.quantity + delta;
      if (newQty <= 0) {
        next.splice(idx, 1);
      } else {
        next[idx] = { ...target, quantity: newQty };
      }
      return next;
    });
  }

  function confirmCombo(protein: ComboOption) {
    if (!comboModal) return;
    const { product, cartIndex } = comboModal;
    setCart((prev) => {
      const target = cartIndex !== null ? prev[cartIndex] : undefined;
      if (cartIndex !== null && target) {
        const next = [...prev];
        next[cartIndex] = { ...target, selectedProtein: protein };
        return next;
      }
      return [...prev, { product, quantity: 1, observations: '', selectedProtein: protein }];
    });
    setComboModal(null);
  }

  const subtotal = cart.reduce((acc, i) => acc + Number(i.product.price) * i.quantity, 0);

  /** Bairros cadastrados na loja, com a taxa de cada um. */
  const zones = activeTenant?.deliveryZones ?? [];

  /** Zona escolhida, casada sem diferenciar maiuscula (igual ao servidor). */
  const selectedZone =
    zones.find((z) => z.name.toLowerCase() === deliveryZone.toLowerCase()) ?? null;

  /**
   * Taxa de entrega, espelhando `resolveDeliveryFee` do backend: so incide em
   * delivery, e o servidor e quem tem a palavra final. Aqui ela existe apenas
   * para o operador ver o mesmo valor que sera cobrado — antes o total do PDV
   * ficava R$ 8,00 abaixo do total real do pedido.
   *
   * Agora respeita o bairro: antes usava SEMPRE a taxa base, entao um bairro
   * distante com taxa propria de R$ 12,00 era exibido como R$ 8,00 e o operador
   * cobrava a menos do que o servidor registrava no pedido.
   */
  const deliveryFee =
    orderType !== 'delivery'
      ? 0
      : selectedZone
        ? Number(selectedZone.fee) || 0
        : Number(activeTenant?.deliveryFeeBase ?? 0) || 0;

  const total = Math.max(0, subtotal + deliveryFee - discount);

  // ── Filtro de produtos ────────────────────────────────────────────────────
  const filtered = products.filter((p) => {
    // Mesmo helper das abas: comparar com `p.category` cru fazia a aba
    // "Marmitas" nunca casar, porque a categoria real vem de `menuCategory`.
    const matchCat = activeCategory === 'Todos' || productCategory(p) === activeCategory;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch && p.active;
  });

  // ── Submeter pedido ───────────────────────────────────────────────────────
  async function submitOrder() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);

    const payload = {
      items: cart.map((i) => ({
        productId: i.product.id,
        quantity: i.quantity,
        unitPrice: Number(i.product.price),
        observations: i.observations || null,
        selectedProteinId: i.selectedProtein?.ingredientId || null,
        selectedProteinName: i.selectedProtein?.label || null,
      })),
      customerId: customerMode === 'found' ? foundCustomer?.id : null,
      newCustomer: customerMode === 'new' ? newCustomerForm : null,
      orderType,
      paymentMethod,
      discount,
      // Faltava enviar: sem `deliveryZone` o backend caia sempre na taxa base,
      // e o bairro cadastrado com taxa propria nunca era cobrado.
      deliveryZone: orderType === 'delivery' ? deliveryZone || null : null,
      observations: orderObservations || null,
    };

    try {
      // Este era o fetch mais critico do sistema: ia com o token da chave errada
      // (`token`), entao a venda falhava com 401 e o operador via apenas um
      // alert genarico "Tente novamente" — sem saber que a sessao era o problema.
      const order = await apiPost<OrderResponse>('/api/orders', payload);
      setLastOrder(order);

      // A impressao agora roda sempre: era condicionada a `isElectron`, que
      // ficou permanentemente falso quando o Electron saiu do projeto — a
      // cozinha nunca recebia a comanda. Passa pelo dialogo do navegador.
      const printItems = cart.map((i) => ({
        productName: i.product.name,
        quantity: i.quantity,
        observations: i.observations || undefined,
        selectedProteinName: i.selectedProtein?.label || undefined,
      }));

      const kitchen = await printKitchen({
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        items: printItems,
        observations: orderObservations || undefined,
        createdAt: order.createdAt,
      });

      let delivery: { success: boolean } = { success: true };
      if (orderType === 'delivery') {
        const customer = foundCustomer || order.customer;
        delivery = await printDelivery({
          orderNumber: order.orderNumber,
          customerName: customer?.name || 'Balcao',
          customerPhone: customer?.phone || '',
          address: customer?.address || newCustomerForm.address || '',
          items: printItems,
          // `order.totalAmount` do servidor, nao o `total` local: o servidor e
          // a autoridade sobre o valor, e a comanda vai na mao do entregador.
          totalAmount: Number(order.totalAmount) || total,
          deliveryFee,
          paymentMethod,
          observations: orderObservations || undefined,
          createdAt: order.createdAt,
        });
      }

      // O pedido ja esta salvo; falha de impressao nao invalida a venda, mas o
      // operador precisa saber para reimprimir em vez de a cozinha ficar sem.
      setPrintWarning(
        kitchen.success && delivery.success
          ? null
          : 'Pedido salvo, mas a impressao falhou. Use "Reimprimir".',
      );

      // Snapshot para o "Reimprimir": o carrinho e limpo logo abaixo, entao sem
      // guardar os itens agora a reimpressao sairia vazia.
      setLastPrint({
        kitchen: {
          orderNumber: order.orderNumber,
          orderType: order.orderType,
          items: printItems,
          observations: orderObservations || undefined,
          createdAt: order.createdAt,
        },
        delivery:
          orderType === 'delivery'
            ? {
                orderNumber: order.orderNumber,
                customerName: (foundCustomer || order.customer)?.name || 'Balcao',
                customerPhone: (foundCustomer || order.customer)?.phone || '',
                address:
                  (foundCustomer || order.customer)?.address || newCustomerForm.address || '',
                items: printItems,
                totalAmount: Number(order.totalAmount) || total,
                deliveryFee,
                paymentMethod,
                observations: orderObservations || undefined,
                createdAt: order.createdAt,
              }
            : null,
      });

      // Resetar estado
      setCart([]);
      setDiscount(0);
      setOrderObservations('');
      setFoundCustomer(null);
      setCustomerSearch('');
      setNewCustomerForm({ name: '', phone: '', address: '', neighborhood: '', city: '' });
      // Zera o bairro: mantido, o proximo pedido herdaria a taxa do anterior e
      // um cliente do centro pagaria a taxa do bairro distante.
      setDeliveryZone('');
      setCustomerMode('search');
      setCheckoutModal(false);
      setSuccessModal(true);
    } catch (err) {
      // `alert` bloqueia o operador e nao diz o motivo. A mensagem real da API
      // ("estoque insuficiente de Frango", "escolha a proteina") aparece agora
      // dentro do modal de checkout, com o carrinho preservado para corrigir.
      setSubmitError(errorMessage(err, 'Nao foi possivel finalizar o pedido.'));
    } finally {
      setSubmitting(false);
    }
  }

  /** Reimprime a ultima comanda a partir do snapshot salvo na venda. */
  async function reprintLastOrder() {
    if (!lastPrint) return;
    const kitchen = await printKitchen(lastPrint.kitchen);
    const delivery = lastPrint.delivery
      ? await printDelivery(lastPrint.delivery)
      : { success: true };
    setPrintWarning(
      kitchen.success && delivery.success ? null : 'A impressao falhou novamente.',
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      {/* ── Coluna esquerda: Catálogo ───────────────────────────────────── */}
      <div style={styles.catalog}>
        {/* Barra superior */}
        <div style={styles.catalogHeader}>
          <div style={styles.orderTypeToggle}>
            {(['delivery', 'balcao'] as OrderType[]).map((t) => (
              <button
                key={t}
                style={{ ...styles.typeBtn, ...(orderType === t ? styles.typeBtnActive : {}) }}
                onClick={() => setOrderType(t)}
              >
                {t === 'delivery' ? 'Delivery' : 'Balcao'}
              </button>
            ))}
          </div>
          <input
            style={styles.searchInput}
            placeholder="Buscar produto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Categorias */}
        <div style={styles.categoryBar}>
          {categories.map((cat) => (
            <button
              key={cat}
              style={{
                ...styles.catBtn,
                ...(activeCategory === cat ? styles.catBtnActive : {}),
              }}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Grid de produtos */}
        {loadingProducts ? (
          <div style={styles.centerMsg}>Carregando produtos...</div>
        ) : productsError ? (
          // Uma falha de catalogo trava a venda, entao ela precisa aparecer com
          // o motivo e um retry — nao virar um "nenhum produto encontrado".
          <div style={styles.centerMsg}>
            <div>{productsError}</div>
            <button
              type="button"
              style={styles.retryBtn}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Tentar de novo
            </button>
          </div>
        ) : (
          <div style={styles.productGrid}>
            {filtered.map((p) => (
              <button
                key={p.id}
                style={styles.productCard}
                onClick={() => addToCart(p)}
              >
                <div
                  style={{
                    ...styles.productCategoryBar,
                    background: CATEGORY_COLORS[productCategory(p)] || 'var(--color-slate)',
                  }}
                />
                <div style={styles.productName}>{p.name}</div>
                {p.productType === 'combo' && (
                  <div style={styles.comboBadge}>COMBO</div>
                )}
                <div style={styles.productPrice}>
                  R$ {Number(p.price).toFixed(2).replace('.', ',')}
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div style={styles.centerMsg}>Nenhum produto encontrado</div>
            )}
          </div>
        )}
      </div>

      {/* ── Coluna direita: Carrinho ──────────────────────────────────────── */}
      <div style={styles.cart}>
        <div style={styles.cartHeader}>
          <span style={styles.cartTitle}>Pedido</span>
          {cart.length > 0 && (
            <button style={styles.clearBtn} onClick={() => setCart([])}>
              Limpar
            </button>
          )}
        </div>

        {/* Cliente */}
        {orderType === 'delivery' && (
          <div style={styles.customerSection}>
            {customerMode === 'search' && (
              <div style={styles.inputRow}>
                <input
                  style={styles.customerInput}
                  placeholder="Telefone do cliente..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') searchCustomer(customerSearch);
                  }}
                />
                <button
                  style={styles.searchBtn}
                  onClick={() => searchCustomer(customerSearch)}
                >
                  Buscar
                </button>
              </div>
            )}

            {customerMode === 'found' && foundCustomer && (
              <div style={styles.customerCard}>
                <div style={styles.customerInfo}>
                  <strong>{foundCustomer.name}</strong>
                  <span>{foundCustomer.phone}</span>
                  <span style={styles.ltvBadge}>
                    LTV: R$ {Number(foundCustomer.ltv).toFixed(2)} | {foundCustomer.totalOrders} pedidos
                  </span>
                </div>
                <button
                  style={styles.changeBtn}
                  onClick={() => { setFoundCustomer(null); setCustomerMode('search'); setCustomerSearch(''); }}
                >
                  Trocar
                </button>
              </div>
            )}

            {customerMode === 'new' && (
              <div style={styles.newCustomerForm}>
                <div style={styles.newCustomerLabel}>Novo cliente</div>
                <input
                  style={styles.formInput}
                  placeholder="Nome *"
                  value={newCustomerForm.name}
                  onChange={(e) => setNewCustomerForm((f) => ({ ...f, name: e.target.value }))}
                />
                <input
                  style={styles.formInput}
                  placeholder="Telefone *"
                  value={newCustomerForm.phone}
                  onChange={(e) => setNewCustomerForm((f) => ({ ...f, phone: e.target.value }))}
                />
                <input
                  style={styles.formInput}
                  placeholder="Endereco"
                  value={newCustomerForm.address}
                  onChange={(e) => setNewCustomerForm((f) => ({ ...f, address: e.target.value }))}
                />
                {/* Bairro do cadastro fica em sincronia com o seletor de taxa:
                    digitar o bairro aqui ja seleciona a zona, e vice-versa.
                    Dois campos independentes divergiriam, e o endereco impresso
                    apontaria um bairro diferente do que foi cobrado. */}
                {/* Sugere os bairros cadastrados sem impedir digitar um novo:
                    a loja atende endereco fora da lista pela taxa padrao. */}
                <datalist id="pdv-zones">
                  {zones.map((z) => (
                    <option key={z.name} value={z.name} />
                  ))}
                </datalist>
                <input
                  style={styles.formInput}
                  placeholder="Bairro"
                  list="pdv-zones"
                  value={newCustomerForm.neighborhood}
                  onChange={(e) => {
                    setNewCustomerForm((f) => ({ ...f, neighborhood: e.target.value }));
                    setDeliveryZone(e.target.value);
                  }}
                />
                <input
                  style={styles.formInput}
                  placeholder="Cidade"
                  value={newCustomerForm.city}
                  onChange={(e) => setNewCustomerForm((f) => ({ ...f, city: e.target.value }))}
                />
                <button
                  style={styles.changeBtn}
                  onClick={() => { setCustomerMode('search'); setCustomerSearch(''); }}
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        )}

        {/* Itens do carrinho */}
        <div style={styles.cartItems}>
          {cart.length === 0 && (
            <div style={styles.emptyCart}>Adicione produtos ao pedido</div>
          )}
          {cart.map((item, idx) => (
            <div key={`${item.product.id}-${idx}`} style={styles.cartItem}>
              <div style={styles.cartItemInfo}>
                <span style={styles.cartItemName}>{item.product.name}</span>
                {item.selectedProtein && (
                  <span style={styles.cartItemProtein}>
                    {item.selectedProtein.label}
                  </span>
                )}
                <input
                  style={styles.obsInput}
                  placeholder="Obs..."
                  value={item.observations}
                  onChange={(e) => {
                    const next = [...cart];
                    next[idx] = { ...item, observations: e.target.value };
                    setCart(next);
                  }}
                />
              </div>
              <div style={styles.cartItemControls}>
                <button style={styles.qtyBtn} onClick={() => updateQty(idx, -1)}>-</button>
                <span style={styles.qtyDisplay}>{item.quantity}</span>
                <button style={styles.qtyBtn} onClick={() => updateQty(idx, 1)}>+</button>
                <span style={styles.itemSubtotal}>
                  R$ {(Number(item.product.price) * item.quantity).toFixed(2).replace('.', ',')}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Totais e finalização */}
        {cart.length > 0 && (
          <div style={styles.cartFooter}>
            <div style={styles.totalRow}>
              <span>Subtotal</span>
              <span>R$ {subtotal.toFixed(2).replace('.', ',')}</span>
            </div>
            {/* Seletor de bairro: e ele que define a taxa. Fica junto dos totais
                de propósito — o operador precisa ver o valor mudar ao escolher. */}
            {orderType === 'delivery' && (
              <div style={styles.zoneRow}>
                <label htmlFor="pdv-zone" style={styles.zoneLabel}>
                  Bairro
                </label>
                <select
                  id="pdv-zone"
                  style={styles.zoneSelect}
                  value={selectedZone ? selectedZone.name : ''}
                  onChange={(e) => {
                    setDeliveryZone(e.target.value);
                    // Mantem o cadastro alinhado com a zona cobrada.
                    if (e.target.value) {
                      setNewCustomerForm((f) => ({ ...f, neighborhood: e.target.value }));
                    }
                  }}
                >
                  <option value="">
                    {zones.length === 0
                      ? 'Sem bairros cadastrados — taxa padrão'
                      : 'Outro bairro — taxa padrão'}
                  </option>
                  {zones.map((z) => (
                    <option key={z.name} value={z.name}>
                      {z.name} — R$ {Number(z.fee).toFixed(2).replace('.', ',')}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {deliveryFee > 0 && (
              <div style={styles.totalRow}>
                <span>
                  Taxa de entrega
                  {selectedZone ? ` (${selectedZone.name})` : ' (padrão)'}
                </span>
                <span>R$ {deliveryFee.toFixed(2).replace('.', ',')}</span>
              </div>
            )}
            {/* Pedido minimo do bairro: avisa, mas nao trava — quem decide abrir
                excecao e o balcao, nao a interface. */}
            {selectedZone && selectedZone.minOrder > 0 && subtotal < selectedZone.minOrder && (
              <div style={styles.zoneWarning} role="alert">
                Pedido mínimo de {selectedZone.name}: R${' '}
                {Number(selectedZone.minOrder).toFixed(2).replace('.', ',')}
              </div>
            )}
            <div style={styles.totalRow}>
              <span>Desconto</span>
              <input
                style={styles.discountInput}
                type="number"
                min="0"
                max={subtotal + deliveryFee}
                step="0.50"
                value={discount}
                onChange={(e) =>
                  setDiscount(
                    Math.max(0, Math.min(Number(e.target.value) || 0, subtotal + deliveryFee)),
                  )
                }
              />
            </div>
            <div style={{ ...styles.totalRow, ...styles.totalFinal }}>
              <span>TOTAL</span>
              <span>R$ {total.toFixed(2).replace('.', ',')}</span>
            </div>

            <div style={styles.paymentMethods}>
              {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  style={{
                    ...styles.payBtn,
                    ...(paymentMethod === m ? styles.payBtnActive : {}),
                  }}
                  onClick={() => setPaymentMethod(m)}
                >
                  {PAYMENT_LABELS[m]}
                </button>
              ))}
            </div>

            <textarea
              style={styles.obsTextarea}
              placeholder="Observacoes gerais..."
              value={orderObservations}
              onChange={(e) => setOrderObservations(e.target.value)}
              rows={2}
            />

            <button
              style={styles.checkoutBtn}
              onClick={() => setCheckoutModal(true)}
            >
              Finalizar Pedido
            </button>
          </div>
        )}
      </div>

      {/* ── Modal: Seletor de proteina do Combo ──��──────────────────────── */}
      {comboModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalTitle}>
              Escolha a proteina — {comboModal.product.name}
            </div>
            <div style={styles.comboOptions}>
              {comboModal.product.comboOptions
                ?.filter((o) => o.group === 'proteina')
                .map((opt) => (
                  <button
                    key={opt.ingredientId}
                    style={styles.comboOptionBtn}
                    onClick={() => confirmCombo(opt)}
                  >
                    {opt.label}
                  </button>
                ))}
            </div>
            <button style={styles.cancelBtn} onClick={() => setComboModal(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: Confirmacao de checkout ───────────────────────────────── */}
      {checkoutModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.modalTitle}>Confirmar Pedido</div>
            <div style={styles.confirmSummary}>
              <div><strong>Tipo:</strong> {orderType === 'delivery' ? 'Delivery' : 'Balcao'}</div>
              <div><strong>Itens:</strong> {cart.reduce((a, i) => a + i.quantity, 0)}</div>
              <div><strong>Total:</strong> R$ {total.toFixed(2).replace('.', ',')}</div>
              <div><strong>Pagamento:</strong> {PAYMENT_LABELS[paymentMethod]}</div>
              {deliveryFee > 0 && (
                <div><strong>Taxa de entrega:</strong> R$ {deliveryFee.toFixed(2).replace('.', ',')}</div>
              )}
              <div style={styles.printNote}>
                Imprime: Cozinha{orderType === 'delivery' ? ' + Entregador' : ''} ({paperWidth})
              </div>
            </div>
            {submitError && (
              <div style={styles.modalError} role="alert">
                {submitError}
              </div>
            )}
            <div style={styles.modalActions}>
              <button
                style={styles.confirmBtn}
                disabled={submitting}
                onClick={submitOrder}
              >
                {submitting ? 'Processando...' : 'Confirmar'}
              </button>
              <button
                style={styles.cancelBtn}
                onClick={() => setCheckoutModal(false)}
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Pedido criado com sucesso ─────────────────────────────── */}
      {successModal && lastOrder && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <div style={styles.successIcon}>OK</div>
            <div style={styles.modalTitle}>Pedido Criado!</div>
            <div style={styles.confirmSummary}>
              <div><strong>Numero:</strong> #{lastOrder.orderNumber}</div>
              <div><strong>Total:</strong> R$ {Number(lastOrder.totalAmount).toFixed(2).replace('.', ',')}</div>
            </div>
            {printWarning && (
              <div style={styles.modalError} role="alert">
                {printWarning}
              </div>
            )}
            <div style={styles.modalActions}>
              <button style={styles.confirmBtn} onClick={() => setSuccessModal(false)}>
                Novo Pedido
              </button>
              {/* Reimprimir a partir do snapshot do pedido: papel enroscado ou
                  dialogo cancelado por engano nao pode custar a comanda. */}
              <button style={styles.cancelBtn} onClick={reprintLastOrder}>
                Reimprimir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Estilos inline (sem CSS externo, conforme regra da fase) ─────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', height: '100vh', background: '#1a1a2e', color: '#e0e0e0',
    fontFamily: 'monospace', overflow: 'hidden',
  },
  catalog: {
    flex: 1, display: 'flex', flexDirection: 'column', borderRight: '2px solid #333',
    overflow: 'hidden',
  },
  catalogHeader: {
    display: 'flex', gap: 8, padding: '10px 12px', background: '#16213e',
    borderBottom: '1px solid #333', alignItems: 'center', flexShrink: 0,
  },
  orderTypeToggle: { display: 'flex', gap: 4 },
  typeBtn: {
    padding: '6px 14px', background: '#2a2a4a', border: '1px solid #555',
    color: '#aaa', cursor: 'pointer', borderRadius: 4, fontSize: 13,
  },
  typeBtnActive: { background: '#0f3460', color: '#fff', borderColor: '#4a90e2' },
  searchInput: {
    flex: 1, padding: '6px 10px', background: '#2a2a4a', border: '1px solid #555',
    color: '#fff', borderRadius: 4, fontSize: 13,
  },
  categoryBar: {
    display: 'flex', gap: 6, padding: '8px 12px', overflowX: 'auto',
    background: '#16213e', borderBottom: '1px solid #333', flexShrink: 0,
  },
  catBtn: {
    padding: '4px 12px', background: '#2a2a4a', border: '1px solid #444',
    color: '#aaa', cursor: 'pointer', borderRadius: 3, fontSize: 12,
    whiteSpace: 'nowrap',
  },
  catBtnActive: { background: '#e74c3c', color: '#fff', borderColor: '#e74c3c' },
  productGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 8, padding: 12, overflowY: 'auto', flex: 1,
    // `alignContent: start` e o que conserta os cards gigantes: o grid e um
    // filho `flex: 1`, entao por padrao ele distribuia a altura sobrando entre
    // as linhas — com 3 produtos, cada card ocupava a tela inteira e o preco
    // (que usa `marginTop: auto`) ia parar longe do nome, fora da area visivel.
    alignContent: 'start',
  },
  productCard: {
    background: '#16213e', border: '1px solid #333', borderRadius: 6,
    cursor: 'pointer', padding: '10px 8px', textAlign: 'left',
    display: 'flex', flexDirection: 'column', gap: 4, position: 'relative',
    transition: 'border-color 0.15s',
    // Altura minima uniforme para a grade nao ficar irregular quando um nome
    // ocupa duas linhas e o vizinho apenas uma.
    minHeight: 96,
  },
  productCategoryBar: { height: 3, borderRadius: 2, marginBottom: 4 },
  productName: { fontSize: 13, fontWeight: 'bold', color: '#e0e0e0', lineHeight: 1.3 },
  productPrice: { fontSize: 14, color: '#4ade80', fontWeight: 'bold', marginTop: 'auto' },
  comboBadge: {
    fontSize: 10, background: '#e67e22', color: '#fff', borderRadius: 3,
    padding: '1px 5px', width: 'fit-content',
  },
  centerMsg: { color: '#666', padding: 24, textAlign: 'center', gridColumn: '1/-1' },
  modalError: {
    marginTop: 12, padding: '10px 12px', borderRadius: 8, fontSize: 13,
    background: 'rgba(220, 38, 38, 0.12)', color: 'var(--color-bad)',
    border: '1px solid rgba(220, 38, 38, 0.35)',
  },
  retryBtn: {
    marginTop: 12, padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
    border: '1px solid var(--color-brand)', background: 'transparent',
    color: 'var(--color-brand)', fontSize: 13, fontWeight: 600,
  },

  // Cart
  cart: {
    width: 360, display: 'flex', flexDirection: 'column', background: '#16213e',
    overflow: 'hidden',
  },
  cartHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 14px', borderBottom: '1px solid #333', flexShrink: 0,
  },
  cartTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  clearBtn: {
    background: 'none', border: '1px solid #c0392b', color: '#c0392b',
    padding: '3px 10px', cursor: 'pointer', borderRadius: 3, fontSize: 12,
  },
  customerSection: {
    padding: '8px 12px', borderBottom: '1px solid #2a2a4a', flexShrink: 0,
  },
  inputRow: { display: 'flex', gap: 6 },
  customerInput: {
    flex: 1, padding: '6px 8px', background: '#2a2a4a', border: '1px solid #555',
    color: '#fff', borderRadius: 4, fontSize: 12,
  },
  searchBtn: {
    padding: '6px 10px', background: '#0f3460', border: 'none',
    color: '#fff', cursor: 'pointer', borderRadius: 4, fontSize: 12,
  },
  customerCard: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    background: '#0f3460', padding: '8px 10px', borderRadius: 6,
  },
  customerInfo: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 },
  ltvBadge: { color: '#4a9e4a', fontSize: 11 },
  changeBtn: {
    background: 'none', border: '1px solid #555', color: '#aaa',
    padding: '3px 8px', cursor: 'pointer', borderRadius: 3, fontSize: 11,
  },
  newCustomerForm: { display: 'flex', flexDirection: 'column', gap: 5 },
  newCustomerLabel: { fontSize: 11, color: '#aaa', fontWeight: 'bold' },
  formInput: {
    padding: '5px 8px', background: '#2a2a4a', border: '1px solid #555',
    color: '#fff', borderRadius: 4, fontSize: 12,
  },
  cartItems: { flex: 1, overflowY: 'auto', padding: '8px 12px' },
  emptyCart: { color: '#555', textAlign: 'center', padding: 32, fontSize: 13 },
  cartItem: {
    borderBottom: '1px solid #2a2a4a', paddingBottom: 8, marginBottom: 8,
    display: 'flex', gap: 8, alignItems: 'flex-start',
  },
  cartItemInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: 3 },
  cartItemName: { fontSize: 13, fontWeight: 'bold', color: '#e0e0e0' },
  cartItemProtein: { fontSize: 11, color: '#e67e22' },
  obsInput: {
    background: '#2a2a4a', border: '1px solid #3a3a5a', color: '#aaa',
    borderRadius: 3, padding: '3px 6px', fontSize: 11, width: '100%',
  },
  cartItemControls: { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 },
  qtyBtn: {
    width: 24, height: 24, background: '#2a2a4a', border: '1px solid #555',
    color: '#fff', cursor: 'pointer', borderRadius: 3, fontSize: 14, lineHeight: 1,
  },
  qtyDisplay: { width: 24, textAlign: 'center', fontSize: 14 },
  itemSubtotal: { fontSize: 12, color: '#4a9e4a', minWidth: 64, textAlign: 'right' },
  cartFooter: {
    padding: '10px 12px', borderTop: '2px solid #333', flexShrink: 0,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  totalRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13 },
  totalFinal: { fontSize: 17, fontWeight: 'bold', color: '#fff' },
  discountInput: {
    width: 70, textAlign: 'right', background: '#2a2a4a',
    border: '1px solid #555', color: '#e0e0e0', borderRadius: 3,
    padding: '2px 6px', fontSize: 13,
  },
  // Bairro/taxa: mesma paleta escura do restante do carrinho.
  zoneRow: { display: 'flex', alignItems: 'center', gap: 8 },
  zoneLabel: { fontSize: 13, color: '#b8b8d0', flexShrink: 0 },
  zoneSelect: {
    flex: 1, minWidth: 0, background: '#2a2a4a', border: '1px solid #555',
    color: '#e0e0e0', borderRadius: 3, padding: '4px 6px', fontSize: 13,
  },
  zoneWarning: {
    background: '#4a3a1a', border: '1px solid #8a6d1a', color: '#f0d98a',
    borderRadius: 3, padding: '5px 8px', fontSize: 12,
  },
  paymentMethods: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  payBtn: {
    padding: '4px 10px', background: '#2a2a4a', border: '1px solid #444',
    color: '#aaa', cursor: 'pointer', borderRadius: 3, fontSize: 11,
  },
  payBtnActive: { background: '#27ae60', color: '#fff', borderColor: '#27ae60' },
  obsTextarea: {
    background: '#2a2a4a', border: '1px solid #555', color: '#ccc',
    borderRadius: 4, padding: '6px 8px', fontSize: 12, resize: 'none',
  },
  checkoutBtn: {
    padding: '12px', background: '#e74c3c', border: 'none',
    color: '#fff', cursor: 'pointer', borderRadius: 6,
    fontSize: 15, fontWeight: 'bold', letterSpacing: 1,
  },

  // Modais
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
  },
  modal: {
    background: '#1a1a2e', border: '1px solid #444', borderRadius: 8,
    padding: 28, minWidth: 320, maxWidth: 420, display: 'flex',
    flexDirection: 'column', gap: 14,
  },
  modalTitle: { fontSize: 17, fontWeight: 'bold', color: '#fff' },
  comboOptions: { display: 'flex', flexDirection: 'column', gap: 8 },
  comboOptionBtn: {
    padding: '12px 16px', background: '#0f3460', border: '1px solid #4a90e2',
    color: '#fff', cursor: 'pointer', borderRadius: 6, fontSize: 14,
    textAlign: 'left',
  },
  confirmSummary: {
    display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14,
    background: '#16213e', padding: 14, borderRadius: 6,
  },
  printNote: { color: '#4a9e4a', fontSize: 12, marginTop: 4 },
  modalActions: { display: 'flex', gap: 10 },
  confirmBtn: {
    flex: 1, padding: '10px', background: '#27ae60', border: 'none',
    color: '#fff', cursor: 'pointer', borderRadius: 6, fontSize: 14, fontWeight: 'bold',
  },
  cancelBtn: {
    padding: '10px 16px', background: 'none', border: '1px solid #555',
    color: '#aaa', cursor: 'pointer', borderRadius: 6, fontSize: 14,
  },
  successIcon: {
    width: 60, height: 60, background: '#27ae60', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 18, fontWeight: 'bold', color: '#fff', alignSelf: 'center',
  },
};
