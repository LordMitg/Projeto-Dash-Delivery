import React, { useState, useEffect, useCallback } from 'react';
import { useTenant } from '../context/TenantContext';
import { usePrinter } from '../hooks/usePrinter';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  sku: string;
  price: string;
  category: string | null;
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
  city?: string;
  ltv: string;
  totalOrders: number;
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

const API = 'http://localhost:3001/api';

// ─── Componente Principal ─────────────────────────────────────────────────────

export function PDV() {
  const { activeTenant } = useTenant();
  const { printKitchen, printDelivery, isElectron } = usePrinter();

  // Catálogo
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('Todos');
  const [search, setSearch] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Carrinho
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('delivery');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [discount, setDiscount] = useState(0);
  const [orderObservations, setOrderObservations] = useState('');

  // Cliente
  const [customerSearch, setCustomerSearch] = useState('');
  const [foundCustomer, setFoundCustomer] = useState<Customer | null>(null);
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '', address: '', city: '' });
  const [customerMode, setCustomerMode] = useState<'search' | 'new' | 'found'>('search');

  // Modais
  const [comboModal, setComboModal] = useState<{ product: Product; cartIndex: number | null } | null>(null);
  const [checkoutModal, setCheckoutModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastOrder, setLastOrder] = useState<any>(null);
  const [successModal, setSuccessModal] = useState(false);

  // ── Carregar produtos ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeTenant) return;
    const token = localStorage.getItem('token');
    setLoadingProducts(true);

    fetch(`${API}/products?active=true`, {
      headers: { Authorization: `Bearer ${token}`, 'x-tenant-id': activeTenant.id },
    })
      .then((r) => r.json())
      .then((data) => {
        const list: Product[] = data.products || [];
        setProducts(list);
        const cats = Array.from(new Set(list.map((p) => p.category || 'Outros').filter(Boolean)));
        setCategories(['Todos', ...cats]);
      })
      .finally(() => setLoadingProducts(false));
  }, [activeTenant]);

  // ── Buscar cliente por telefone ───────────────────────────────────────────
  const searchCustomer = useCallback(
    async (phone: string) => {
      if (phone.length < 8 || !activeTenant) return;
      const token = localStorage.getItem('token');
      const res = await fetch(`${API}/customers?phone=${phone}`, {
        headers: { Authorization: `Bearer ${token}`, 'x-tenant-id': activeTenant.id },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.customers?.length > 0) {
          setFoundCustomer(data.customers[0]);
          setCustomerMode('found');
        } else {
          setFoundCustomer(null);
          setNewCustomerForm((f) => ({ ...f, phone }));
          setCustomerMode('new');
        }
      }
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
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { product, quantity: 1, observations: '', selectedProtein: null }];
    });
  }

  function updateQty(idx: number, delta: number) {
    setCart((prev) => {
      const next = [...prev];
      const newQty = next[idx].quantity + delta;
      if (newQty <= 0) {
        next.splice(idx, 1);
      } else {
        next[idx] = { ...next[idx], quantity: newQty };
      }
      return next;
    });
  }

  function confirmCombo(protein: ComboOption) {
    if (!comboModal) return;
    const { product, cartIndex } = comboModal;
    setCart((prev) => {
      if (cartIndex !== null) {
        const next = [...prev];
        next[cartIndex] = { ...next[cartIndex], selectedProtein: protein };
        return next;
      }
      return [...prev, { product, quantity: 1, observations: '', selectedProtein: protein }];
    });
    setComboModal(null);
  }

  const subtotal = cart.reduce((acc, i) => acc + Number(i.product.price) * i.quantity, 0);
  const total = Math.max(0, subtotal - discount);

  // ── Filtro de produtos ────────────────────────────────────────────────────
  const filtered = products.filter((p) => {
    const matchCat = activeCategory === 'Todos' || p.category === activeCategory;
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch && p.active;
  });

  // ── Submeter pedido ───────────────────────────────────────────────────────
  async function submitOrder() {
    if (cart.length === 0) return;
    setSubmitting(true);
    const token = localStorage.getItem('token');

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
      observations: orderObservations || null,
    };

    try {
      const res = await fetch(`${API}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-tenant-id': activeTenant!.id,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Erro ao criar pedido');
      const data = await res.json();
      setLastOrder(data.order);

      // Impressão automática se Electron disponível
      if (isElectron) {
        const printItems = cart.map((i) => ({
          productName: i.product.name,
          quantity: i.quantity,
          observations: i.observations || undefined,
          selectedProteinName: i.selectedProtein?.label || undefined,
        }));

        await printKitchen({
          orderNumber: data.order.orderNumber,
          orderType: data.order.orderType,
          items: printItems,
          observations: orderObservations || undefined,
          createdAt: data.order.createdAt,
        });

        if (orderType === 'delivery') {
          const customer = foundCustomer || data.order.customer;
          await printDelivery({
            orderNumber: data.order.orderNumber,
            customerName: customer?.name || 'Balcao',
            customerPhone: customer?.phone || '',
            address: customer?.address || newCustomerForm.address || '',
            items: printItems,
            totalAmount: total,
            paymentMethod,
            observations: orderObservations || undefined,
            createdAt: data.order.createdAt,
          });
        }
      }

      // Resetar estado
      setCart([]);
      setDiscount(0);
      setOrderObservations('');
      setFoundCustomer(null);
      setCustomerSearch('');
      setNewCustomerForm({ name: '', phone: '', address: '', city: '' });
      setCustomerMode('search');
      setCheckoutModal(false);
      setSuccessModal(true);
    } catch (err) {
      alert('Erro ao finalizar pedido. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
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
                    background: CATEGORY_COLORS[p.category || ''] || '#555',
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
                    next[idx] = { ...next[idx], observations: e.target.value };
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
            <div style={styles.totalRow}>
              <span>Desconto</span>
              <input
                style={styles.discountInput}
                type="number"
                min="0"
                max={subtotal}
                step="0.50"
                value={discount}
                onChange={(e) => setDiscount(Math.min(Number(e.target.value), subtotal))}
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

      {/* ── Modal: Seletor de proteina do Combo ─────────────────────────── */}
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
              {isElectron && (
                <div style={styles.printNote}>
                  Impressao automatica: Cozinha{orderType === 'delivery' ? ' + Entregador' : ''}
                </div>
              )}
            </div>
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
            <button style={styles.confirmBtn} onClick={() => setSuccessModal(false)}>
              Novo Pedido
            </button>
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
  },
  productCard: {
    background: '#16213e', border: '1px solid #333', borderRadius: 6,
    cursor: 'pointer', padding: '10px 8px', textAlign: 'left',
    display: 'flex', flexDirection: 'column', gap: 4, position: 'relative',
    transition: 'border-color 0.15s',
  },
  productCategoryBar: { height: 3, borderRadius: 2, marginBottom: 4 },
  productName: { fontSize: 13, fontWeight: 'bold', color: '#e0e0e0', lineHeight: 1.3 },
  productPrice: { fontSize: 14, color: '#4a9e4a', fontWeight: 'bold', marginTop: 'auto' },
  comboBadge: {
    fontSize: 10, background: '#e67e22', color: '#fff', borderRadius: 3,
    padding: '1px 5px', width: 'fit-content',
  },
  centerMsg: { color: '#666', padding: 24, textAlign: 'center', gridColumn: '1/-1' },

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
