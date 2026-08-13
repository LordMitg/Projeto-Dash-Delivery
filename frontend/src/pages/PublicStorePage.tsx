import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Bell, Check, ChevronRight, Clock3, Heart, Home, Minus, PackageCheck,
  Percent, Plus, ReceiptText, Search, ShieldCheck, ShoppingBag, ShoppingCart,
  Store, Trash2, Truck, UserRound, X,
} from 'lucide-react'
import { apiGet, apiPost, errorMessage } from '../lib/api'

type Addon = { id: string; name: string; price: number | string; groupName: string; required: boolean; maxQuantity: number }
type ComboOption = { group?: string; label?: string; ingredientId?: string }
type Product = {
  id: string; name: string; description?: string | null; price: number | string
  imageUrl?: string | null; featured: boolean; productType: string
  comboOptions?: ComboOption[] | null; addons: Addon[]
}
type Category = { id: string; name: string; slug: string; description?: string | null; imageUrl?: string | null; products: Product[] }
type DeliveryZone = { name: string; fee: number; minOrder?: number; etaMinutes?: number }
type StorefrontTheme = {
  primaryColor: string; accentColor: string; backgroundColor: string; textColor: string
  tagline: string; bannerTitle: string; bannerSubtitle: string; bannerImageUrl: string
}
type MenuData = {
  store: { name: string; slug: string; phone?: string | null; address?: string | null; city?: string | null; state?: string | null; logoData?: string | null }
  theme?: Partial<StorefrontTheme> | null
  status: { open: boolean; reason?: string; nextOpening?: string | null }
  deliveryFeeBase: number | string
  deliveryZones: DeliveryZone[]
  categories: Category[]
}
type CartItem = {
  key: string; product: Product; quantity: number; observations: string
  selectedProteinId?: string; selectedProteinName?: string
  addons: Array<{ addonId: string; name: string; price: number; quantity: number }>
}
type Customer = { name: string; phone: string; address: string; neighborhood: string; city: string; state: string; zipCode: string }
type RecentOrder = { token: string; orderNumber: string; totalAmount: number; createdAt: string }

const defaultTheme: StorefrontTheme = {
  primaryColor: '#4A103A', accentColor: '#D9A629', backgroundColor: '#FFF8EE', textColor: '#251522',
  tagline: 'Feito com carinho, entregue quentinho.', bannerTitle: 'Seu pedido favorito está aqui',
  bannerSubtitle: 'Escolha, personalize e peça em poucos minutos.', bannerImageUrl: '',
}
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const digits = (value: string) => value.replace(/\D/g, '')
const itemTotal = (item: CartItem) => (Number(item.product.price) + item.addons.reduce((sum, addon) => sum + addon.price * addon.quantity, 0)) * item.quantity

function ProductImage({ product, className = '' }: { product: Product; className?: string }) {
  if (product.imageUrl) return <img src={product.imageUrl} alt={product.name} className={`h-full w-full object-cover ${className}`} />
  return <div className={`grid h-full w-full place-items-center bg-gradient-to-br from-white to-[#ead8c7] ${className}`}><ShoppingBag className="h-10 w-10 opacity-25" /></div>
}

export default function PublicStorePage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [menu, setMenu] = useState<MenuData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [selected, setSelected] = useState<Product | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [selectedProteinId, setSelectedProteinId] = useState('')
  const [addonQty, setAddonQty] = useState<Record<string, number>>({})
  const [itemNotes, setItemNotes] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [checkout, setCheckout] = useState(false)
  const [orderType, setOrderType] = useState<'delivery' | 'balcao'>('delivery')
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'cash' | 'credit' | 'debit'>('pix')
  const [changeFor, setChangeFor] = useState('')
  const [customer, setCustomer] = useState<Customer>({ name: '', phone: '', address: '', neighborhood: '', city: '', state: '', zipCode: '' })
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'found' | 'new'>('idle')
  const [lastLookup, setLastLookup] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [utilityPanel, setUtilityPanel] = useState<'orders' | 'profile' | null>(null)
  const [favorites, setFavorites] = useState<string[]>([])
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([])

  useEffect(() => {
    apiGet<MenuData>(`/api/public/${encodeURIComponent(slug)}/menu`)
      .then(setMenu)
      .catch((err) => setError(errorMessage(err, 'Não foi possível abrir este cardápio.')))
      .finally(() => setLoading(false))
  }, [slug])

  // O cliente nao perde carrinho, favoritos nem seus dados ao fechar a aba.
  // Tudo fica apenas neste dispositivo; pedidos reais continuam no servidor.
  useEffect(() => {
    try {
      const savedCart = localStorage.getItem(`delione_cart_${slug}`)
      const savedCustomer = localStorage.getItem('delione_consumer_profile')
      const savedFavorites = localStorage.getItem(`delione_favorites_${slug}`)
      const savedOrders = localStorage.getItem(`delione_orders_${slug}`)
      if (savedCart) setCart(JSON.parse(savedCart) as CartItem[])
      if (savedCustomer) setCustomer(JSON.parse(savedCustomer) as Customer)
      if (savedFavorites) setFavorites(JSON.parse(savedFavorites) as string[])
      if (savedOrders) setRecentOrders(JSON.parse(savedOrders) as RecentOrder[])
    } catch { /* armazenamento e apenas conveniencia */ }
  }, [slug])

  useEffect(() => { try { localStorage.setItem(`delione_cart_${slug}`, JSON.stringify(cart)) } catch { /* opcional */ } }, [cart, slug])
  useEffect(() => { try { localStorage.setItem('delione_consumer_profile', JSON.stringify(customer)) } catch { /* opcional */ } }, [customer])
  useEffect(() => { try { localStorage.setItem(`delione_favorites_${slug}`, JSON.stringify(favorites)) } catch { /* opcional */ } }, [favorites, slug])

  const theme = { ...defaultTheme, ...(menu?.theme ?? {}) }
  const allProducts = useMemo(() => menu?.categories.flatMap((category) => category.products) ?? [], [menu])
  const featured = allProducts.filter((product) => product.featured).slice(0, 6)
  const visibleCategories = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return (menu?.categories ?? []).map((category) => ({
      ...category,
      products: category.products.filter((product) =>
        (categoryId === 'all' || category.id === categoryId) &&
        (!term || `${product.name} ${product.description ?? ''}`.toLocaleLowerCase('pt-BR').includes(term)),
      ),
    })).filter((category) => category.products.length > 0)
  }, [categoryId, menu, search])
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const subtotal = cart.reduce((sum, item) => sum + itemTotal(item), 0)
  const selectedZone = menu?.deliveryZones.find((zone) => zone.name.toLocaleLowerCase('pt-BR') === customer.neighborhood.toLocaleLowerCase('pt-BR'))
  const deliveryFee = orderType === 'delivery' ? Number(selectedZone?.fee ?? menu?.deliveryFeeBase ?? 0) : 0
  const total = subtotal + deliveryFee
  const heroImage = theme.bannerImageUrl || featured.find((product) => product.imageUrl)?.imageUrl || ''
  const favoriteProducts = allProducts.filter((product) => favorites.includes(product.id))

  function toggleFavorite(productId: string) {
    setFavorites((current) => current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId])
  }

  function goTo(section: 'home' | 'menu' | 'offers') {
    setUtilityPanel(null)
    if (section === 'home') { setCategoryId('all'); setSearch(''); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    if (section === 'offers') { setCategoryId('all'); setSearch(''); document.getElementById('ofertas')?.scrollIntoView({ behavior: 'smooth' }); return }
    document.getElementById('produtos')?.scrollIntoView({ behavior: 'smooth' })
  }

  function openProduct(product: Product) {
    setSelected(product); setQuantity(1); setAddonQty({}); setItemNotes('')
    setSelectedProteinId(product.comboOptions?.[0]?.ingredientId ?? '')
  }

  function addSelected() {
    if (!selected) return
    const requiredGroups = [...new Set(selected.addons.filter((addon) => addon.required).map((addon) => addon.groupName))]
    const missing = requiredGroups.find((group) => !selected.addons.some((addon) => addon.groupName === group && (addonQty[addon.id] ?? 0) > 0))
    if (missing) { setCheckoutError(`Escolha uma opção de ${missing}.`); return }
    const option = selected.comboOptions?.find((item) => item.ingredientId === selectedProteinId)
    const addons = selected.addons.filter((addon) => (addonQty[addon.id] ?? 0) > 0).map((addon) => ({ addonId: addon.id, name: addon.name, price: Number(addon.price), quantity: addonQty[addon.id] ?? 0 }))
    setCart((current) => [...current, { key: crypto.randomUUID(), product: selected, quantity, observations: itemNotes.trim(), selectedProteinId: selectedProteinId || undefined, selectedProteinName: option?.label, addons }])
    setSelected(null); setCheckoutError('')
  }

  function changeCartQuantity(key: string, delta: number) {
    setCart((current) => current.map((item) => item.key === key ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item).filter((item) => item.quantity > 0))
  }

  async function lookupCustomer() {
    const phone = digits(customer.phone)
    if (phone.length < 10 || phone === lastLookup) return
    setLastLookup(phone); setLookupState('loading')
    try {
      const result = await apiPost<{ found: boolean; profile: Customer | null }>('/api/public/customers/lookup', { phone })
      if (result.found && result.profile) {
        setCustomer((current) => ({ ...current, ...Object.fromEntries(Object.entries(result.profile!).map(([key, value]) => [key, value ?? ''])), phone }))
        setLookupState('found')
      } else setLookupState('new')
    } catch { setLookupState('idle') }
  }

  async function submitOrder(event: React.FormEvent) {
    event.preventDefault(); setCheckoutError('')
    if (!menu?.status.open) { setCheckoutError('A loja está fechada no momento.'); return }
    if (digits(customer.phone).length < 10) { setCheckoutError('Informe um telefone com DDD.'); return }
    setSubmitting(true)
    try {
      const result = await apiPost<{ publicToken: string; orderNumber: string; totalAmount: number }>(`/api/public/${encodeURIComponent(slug)}/orders`, {
        items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, observations: item.observations || null, selectedProteinId: item.selectedProteinId || null, addons: item.addons.map(({ addonId, quantity: addonQuantity }) => ({ addonId, quantity: addonQuantity })) })),
        customer: { ...customer, phone: digits(customer.phone) }, orderType, paymentMethod,
        changeFor: paymentMethod === 'cash' && changeFor ? Number(changeFor.replace(',', '.')) : null,
      })
      try {
        localStorage.setItem(`delione_order_${result.publicToken}`, JSON.stringify({ token: result.publicToken, slug }))
        const nextOrders = [{ token: result.publicToken, orderNumber: result.orderNumber, totalAmount: Number(result.totalAmount), createdAt: new Date().toISOString() }, ...recentOrders].slice(0, 12)
        localStorage.setItem(`delione_orders_${slug}`, JSON.stringify(nextOrders))
        setRecentOrders(nextOrders)
        localStorage.removeItem(`delione_cart_${slug}`)
      } catch { /* opcional */ }
      setCart([])
      navigate(`/pedido/${result.publicToken}`)
    } catch (err) { setCheckoutError(errorMessage(err, 'Não foi possível enviar seu pedido.')) }
    finally { setSubmitting(false) }
  }

  if (loading) return <div className="grid min-h-screen place-items-center bg-[#fff8ee]"><div className="text-center"><ShoppingBag className="mx-auto h-8 w-8 animate-pulse text-[#4a103a]" /><p className="mt-3 text-sm">Abrindo o cardápio...</p></div></div>
  if (error || !menu) return <div className="grid min-h-screen place-items-center bg-[#fff8ee] p-6 text-center"><div><Store className="mx-auto h-10 w-10 text-[#4a103a]" /><h1 className="mt-4 text-xl font-bold">Cardápio indisponível</h1><p className="mt-2 text-sm opacity-70">{error}</p></div></div>

  const cssVars = { '--store-primary': theme.primaryColor, '--store-accent': theme.accentColor, '--store-bg': theme.backgroundColor, '--store-text': theme.textColor } as React.CSSProperties

  return (
    <div className="min-h-screen pb-28" style={{ ...cssVars, backgroundColor: theme.backgroundColor, color: theme.textColor }}>
      <header className="sticky top-0 z-30 border-b border-black/5 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            {menu.store.logoData ? <img src={menu.store.logoData} alt={`Logo ${menu.store.name}`} className="h-full w-full object-cover" /> : <span className="font-display text-xl font-bold" style={{ color: theme.primaryColor }}>{menu.store.name[0]}</span>}
          </div>
          <div className="min-w-0 flex-1"><p className="text-[11px] font-medium opacity-60">Olá! Bem-vindo(a) 👋</p><h1 className="truncate text-base font-extrabold sm:text-lg" style={{ color: theme.primaryColor }}>{menu.store.name}</h1><p className="hidden truncate text-xs opacity-60 sm:block">{theme.tagline}</p></div>
          <button type="button" onClick={() => setUtilityPanel('orders')} aria-label="Ver pedidos" className="relative hidden h-11 w-11 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5 sm:grid"><ReceiptText className="h-5 w-5" />{recentOrders.length > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold" style={{ backgroundColor: theme.accentColor, color: theme.primaryColor }}>{recentOrders.length}</span>}</button>
          <button type="button" onClick={() => setCartOpen(true)} aria-label="Abrir carrinho" className="relative grid h-11 w-11 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
            <ShoppingCart className="h-5 w-5" />{cartCount > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-bold" style={{ backgroundColor: theme.accentColor, color: theme.primaryColor }}>{cartCount}</span>}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5"><Search className="h-5 w-5 opacity-45" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Busque sua comida favorita..." className="!border-0 !bg-transparent !p-0 !shadow-none" /></div>

        {!menu.status.open && <div className="mt-4 flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"><Clock3 className="h-5 w-5" /><div><strong>Loja fechada agora</strong><p className="text-xs opacity-75">Você pode olhar o cardápio; o pedido será liberado quando a loja abrir.</p></div></div>}

        <section className="relative mt-5 min-h-[270px] overflow-hidden rounded-[30px] p-7 text-white shadow-xl sm:min-h-[330px] sm:p-10" style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColor}c9)` }}>
          {heroImage && <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" />}
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/35 to-transparent" />
          <div className="relative z-10 flex min-h-[216px] max-w-lg flex-col justify-end sm:min-h-[250px]"><span className="mb-3 w-fit rounded-full bg-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur">Peça direto da loja</span><h2 className="text-3xl font-black leading-tight sm:text-5xl">{theme.bannerTitle}</h2><p className="mt-3 max-w-md text-sm text-white/85 sm:text-base">{theme.bannerSubtitle}</p><button type="button" onClick={() => document.getElementById('produtos')?.scrollIntoView({ behavior: 'smooth' })} className="mt-5 w-fit rounded-full px-5 py-3 text-sm font-extrabold shadow-lg" style={{ backgroundColor: theme.accentColor, color: theme.primaryColor }}>Pedir agora <ChevronRight className="h-4 w-4" /></button></div>
        </section>

        <nav className="-mx-4 mt-6 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0" aria-label="Categorias">
          <button type="button" onClick={() => setCategoryId('all')} className="flex min-w-[72px] flex-col items-center gap-2 !p-0 text-xs font-semibold"><span className="grid h-16 w-16 place-items-center rounded-full bg-white shadow-sm ring-2" style={{ borderColor: categoryId === 'all' ? theme.accentColor : 'transparent', color: theme.primaryColor }}><Store className="h-6 w-6" /></span>Todos</button>
          {menu.categories.map((category) => {
            const image = category.imageUrl || category.products.find((product) => product.imageUrl)?.imageUrl
            return <button key={category.id} type="button" onClick={() => setCategoryId(category.id)} className="flex min-w-[72px] flex-col items-center gap-2 !p-0 text-xs font-semibold"><span className="h-16 w-16 overflow-hidden rounded-full bg-white shadow-sm ring-2" style={{ borderColor: categoryId === category.id ? theme.accentColor : 'transparent' }}>{image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center"><ShoppingBag className="h-5 w-5 opacity-35" /></span>}</span><span className="max-w-[82px] truncate">{category.name}</span></button>
          })}
        </nav>

        <section id="ofertas" className="scroll-mt-24 mt-7 grid gap-3 sm:grid-cols-3">
          <article className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"><span className="grid h-11 w-11 place-items-center rounded-full" style={{ backgroundColor: `${theme.accentColor}25`, color: theme.primaryColor }}><Percent className="h-5 w-5" /></span><div><h3 className="text-sm font-extrabold">Ofertas da loja</h3><p className="text-xs opacity-55">Destaques e combos em um só lugar.</p></div></article>
          <article className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"><span className="grid h-11 w-11 place-items-center rounded-full" style={{ backgroundColor: `${theme.accentColor}25`, color: theme.primaryColor }}><Truck className="h-5 w-5" /></span><div><h3 className="text-sm font-extrabold">Entrega por bairro</h3><p className="text-xs opacity-55">Taxa calculada antes de confirmar.</p></div></article>
          <article className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5"><span className="grid h-11 w-11 place-items-center rounded-full" style={{ backgroundColor: `${theme.accentColor}25`, color: theme.primaryColor }}><ShieldCheck className="h-5 w-5" /></span><div><h3 className="text-sm font-extrabold">Pedido acompanhado</h3><p className="text-xs opacity-55">Veja cada etapa em tempo real.</p></div></article>
        </section>

        {featured.length > 0 && categoryId === 'all' && !search && <section className="mt-8"><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-wider" style={{ color: theme.primaryColor }}>Os queridinhos</p><h2 className="text-2xl font-extrabold">Destaques</h2></div></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{featured.slice(0, 4).map((product) => <ProductCard key={`featured-${product.id}`} product={product} theme={theme} onClick={() => openProduct(product)} />)}</div></section>}

        {favoriteProducts.length > 0 && categoryId === 'all' && !search && <section className="mt-8"><div className="mb-4"><p className="text-xs font-bold uppercase tracking-wider" style={{ color: theme.primaryColor }}>Salvos por você</p><h2 className="text-2xl font-extrabold">Seus favoritos</h2></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{favoriteProducts.map((product) => <ProductCard key={`favorite-${product.id}`} product={product} theme={theme} favorite onFavorite={() => toggleFavorite(product.id)} onClick={() => openProduct(product)} />)}</div></section>}

        <div id="produtos" className="scroll-mt-24">
          {visibleCategories.map((category) => <section key={category.id} className="mt-9"><div className="mb-4"><h2 className="text-2xl font-extrabold">{category.name}</h2>{category.description && <p className="mt-1 text-sm opacity-60">{category.description}</p>}</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{category.products.map((product) => <ProductCard key={product.id} product={product} theme={theme} favorite={favorites.includes(product.id)} onFavorite={() => toggleFavorite(product.id)} onClick={() => openProduct(product)} />)}</div></section>)}
          {visibleCategories.length === 0 && <div className="py-20 text-center opacity-60"><Search className="mx-auto h-8 w-8" /><p className="mt-2 font-semibold">Nenhum produto encontrado.</p></div>}
        </div>
      </main>

      {cartCount > 0 && !cartOpen && <button type="button" onClick={() => setCartOpen(true)} className="fixed bottom-[82px] left-1/2 z-30 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center justify-between rounded-2xl px-5 py-4 text-white shadow-2xl sm:bottom-5" style={{ backgroundColor: theme.primaryColor }}><span className="flex items-center gap-3"><span className="grid h-7 min-w-7 place-items-center rounded-full px-1 text-xs font-bold" style={{ backgroundColor: theme.accentColor, color: theme.primaryColor }}>{cartCount}</span><span className="font-bold">Ver carrinho</span></span><strong>{money.format(subtotal)}</strong></button>}

      <nav aria-label="Navegação da loja" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-black/10 bg-white/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_28px_rgba(0,0,0,.08)] backdrop-blur sm:hidden">
        <BottomAction label="Início" icon={<Home className="h-5 w-5" />} active onClick={() => goTo('home')} theme={theme} />
        <BottomAction label="Cardápio" icon={<ShoppingBag className="h-5 w-5" />} onClick={() => goTo('menu')} theme={theme} />
        <BottomAction label="Ofertas" icon={<Percent className="h-5 w-5" />} onClick={() => goTo('offers')} theme={theme} />
        <BottomAction label="Pedidos" icon={<ReceiptText className="h-5 w-5" />} badge={recentOrders.length} onClick={() => setUtilityPanel('orders')} theme={theme} />
        <BottomAction label="Perfil" icon={<UserRound className="h-5 w-5" />} onClick={() => setUtilityPanel('profile')} theme={theme} />
      </nav>

      {selected && <ProductDialog product={selected} theme={theme} quantity={quantity} setQuantity={setQuantity} selectedProteinId={selectedProteinId} setSelectedProteinId={setSelectedProteinId} addonQty={addonQty} setAddonQty={setAddonQty} itemNotes={itemNotes} setItemNotes={setItemNotes} error={checkoutError} onClose={() => { setSelected(null); setCheckoutError('') }} onAdd={addSelected} />}

      {utilityPanel && <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setUtilityPanel(null) }}><aside className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-black/10 p-5"><div><p className="text-xs font-bold uppercase tracking-wider opacity-50">Sua conta DeliOne</p><h2 className="text-2xl font-extrabold">{utilityPanel === 'orders' ? 'Meus pedidos' : 'Meu perfil'}</h2></div><button type="button" onClick={() => setUtilityPanel(null)} className="grid h-10 w-10 place-items-center rounded-full bg-black/5"><X className="h-5 w-5" /></button></header>
        {utilityPanel === 'orders' ? <div className="flex-1 overflow-y-auto p-5">{recentOrders.length ? <div className="space-y-3">{recentOrders.map((order) => <button type="button" key={order.token} onClick={() => navigate(`/pedido/${order.token}`)} className="flex w-full items-center gap-3 rounded-2xl border border-black/10 p-4 text-left hover:bg-black/[0.025]"><span className="grid h-11 w-11 place-items-center rounded-full" style={{ backgroundColor: `${theme.primaryColor}12`, color: theme.primaryColor }}><PackageCheck className="h-5 w-5" /></span><span className="min-w-0 flex-1"><strong className="block">Pedido #{order.orderNumber}</strong><small className="opacity-55">{new Date(order.createdAt).toLocaleString('pt-BR')}</small></span><span className="text-right"><strong className="block">{money.format(order.totalAmount)}</strong><small style={{ color: theme.primaryColor }}>Acompanhar</small></span></button>)}</div> : <div className="py-20 text-center opacity-55"><ReceiptText className="mx-auto h-10 w-10" /><h3 className="mt-3 font-bold">Nenhum pedido neste dispositivo</h3><p className="mt-1 text-sm">Quando você pedir, o acompanhamento ficará aqui.</p></div>}</div> :
        <div className="flex-1 overflow-y-auto p-5"><div className="rounded-2xl p-4" style={{ backgroundColor: `${theme.primaryColor}0d` }}><div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-full text-white" style={{ backgroundColor: theme.primaryColor }}><UserRound className="h-6 w-6" /></span><div><h3 className="font-extrabold">{customer.name || 'Seu perfil'}</h3><p className="text-sm opacity-55">{customer.phone || 'Informe seu telefone no checkout'}</p></div></div></div><div className="mt-5 space-y-3"><InfoRow label="Nome" value={customer.name} /><InfoRow label="Telefone" value={customer.phone} /><InfoRow label="Endereço" value={customer.address} /><InfoRow label="Bairro" value={customer.neighborhood} /><InfoRow label="Cidade" value={[customer.city, customer.state].filter(Boolean).join(' - ')} /></div><div className="mt-6 flex gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-green-800"><ShieldCheck className="h-5 w-5 shrink-0" /><p className="text-sm">Seus dados são usados para agilizar novos pedidos. O histórico de compras de cada loja continua separado.</p></div><button type="button" onClick={() => { setUtilityPanel(null); setCartOpen(true); setCheckout(true) }} className="mt-5 w-full justify-center rounded-xl py-3 font-bold text-white" style={{ backgroundColor: theme.primaryColor }}>Atualizar no próximo pedido</button></div>}
      </aside></div>}

      {cartOpen && <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setCartOpen(false) }}><aside className="ml-auto flex h-full w-full max-w-lg flex-col bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-black/10 p-5"><div><p className="text-xs font-bold uppercase tracking-wider opacity-50">Seu pedido</p><h2 className="text-2xl font-extrabold">{checkout ? 'Finalizar pedido' : 'Carrinho'}</h2></div><button type="button" onClick={() => { setCartOpen(false); setCheckout(false) }} className="grid h-10 w-10 place-items-center rounded-full bg-black/5"><X className="h-5 w-5" /></button></div>
        {!checkout ? <><div className="flex-1 space-y-3 overflow-y-auto p-5">{cart.map((item) => <article key={item.key} className="flex gap-3 rounded-2xl border border-black/10 p-3"><div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl"><ProductImage product={item.product} /></div><div className="min-w-0 flex-1"><h3 className="font-bold">{item.product.name}</h3>{item.selectedProteinName && <p className="text-xs opacity-55">{item.selectedProteinName}</p>}<p className="mt-1 text-sm font-bold" style={{ color: theme.primaryColor }}>{money.format(itemTotal(item))}</p><div className="mt-2 flex items-center justify-between"><span className="flex items-center gap-1 rounded-full bg-black/5"><button type="button" onClick={() => changeCartQuantity(item.key, -1)} className="grid h-8 w-8 place-items-center"><Minus className="h-3.5 w-3.5" /></button><strong className="w-5 text-center text-sm">{item.quantity}</strong><button type="button" onClick={() => changeCartQuantity(item.key, 1)} className="grid h-8 w-8 place-items-center"><Plus className="h-3.5 w-3.5" /></button></span><button type="button" onClick={() => setCart((current) => current.filter((currentItem) => currentItem.key !== item.key))} className="grid h-8 w-8 place-items-center text-red-600"><Trash2 className="h-4 w-4" /></button></div></div></article>)}</div><div className="border-t border-black/10 p-5"><div className="mb-4 flex justify-between text-lg"><span>Subtotal</span><strong>{money.format(subtotal)}</strong></div><button type="button" disabled={!cart.length} onClick={() => setCheckout(true)} className="w-full justify-center rounded-xl py-4 text-base font-extrabold text-white" style={{ backgroundColor: theme.primaryColor }}>Continuar <ChevronRight className="h-5 w-5" /></button></div></> :
        <form onSubmit={submitOrder} className="flex min-h-0 flex-1 flex-col"><div className="flex-1 space-y-5 overflow-y-auto p-5"><button type="button" onClick={() => setCheckout(false)} className="!p-0 text-sm font-semibold opacity-65"><ArrowLeft className="h-4 w-4" /> Voltar ao carrinho</button>
          <fieldset><legend className="mb-2 font-bold">Como deseja receber?</legend><div className="grid grid-cols-2 gap-2"><Choice active={orderType === 'delivery'} onClick={() => setOrderType('delivery')} icon={<Truck className="h-5 w-5" />} label="Entrega" theme={theme} /><Choice active={orderType === 'balcao'} onClick={() => setOrderType('balcao')} icon={<Store className="h-5 w-5" />} label="Retirada" theme={theme} /></div></fieldset>
          <fieldset className="space-y-3"><legend className="font-bold">Seus dados</legend><label><span>Telefone</span><div className="relative"><input required inputMode="tel" value={customer.phone} onChange={(e) => { setCustomer({ ...customer, phone: e.target.value }); setLookupState('idle') }} onBlur={() => void lookupCustomer()} placeholder="(11) 99999-9999" className="pr-28" />{lookupState === 'loading' && <span className="absolute right-3 top-2.5 text-xs opacity-50">Buscando...</span>}{lookupState === 'found' && <span className="absolute right-3 top-2.5 text-xs font-bold text-green-700">Cadastro encontrado</span>}</div></label><label><span>Nome</span><input required value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="Como podemos chamar você?" /></label>
          {orderType === 'delivery' && <><label><span>Endereço e número</span><input required value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} placeholder="Rua, número e complemento" /></label><label><span>Bairro</span>{menu.deliveryZones.length > 0 ? <select required value={customer.neighborhood} onChange={(e) => setCustomer({ ...customer, neighborhood: e.target.value })}><option value="">Selecione...</option>{menu.deliveryZones.map((zone) => <option key={zone.name} value={zone.name}>{zone.name} · {money.format(Number(zone.fee))}</option>)}</select> : <input required value={customer.neighborhood} onChange={(e) => setCustomer({ ...customer, neighborhood: e.target.value })} />}</label><div className="grid grid-cols-[1fr_80px] gap-2"><label><span>Cidade</span><input value={customer.city} onChange={(e) => setCustomer({ ...customer, city: e.target.value })} /></label><label><span>UF</span><input maxLength={2} value={customer.state} onChange={(e) => setCustomer({ ...customer, state: e.target.value.toUpperCase() })} /></label></div></>}
          </fieldset>
          <fieldset><legend className="mb-2 font-bold">Pagamento</legend><div className="grid grid-cols-2 gap-2">{([['pix', 'Pix'], ['credit', 'Crédito'], ['debit', 'Débito'], ['cash', 'Dinheiro']] as const).map(([value, label]) => <Choice key={value} active={paymentMethod === value} onClick={() => setPaymentMethod(value)} icon={paymentMethod === value ? <Check className="h-4 w-4" /> : <span className="h-4 w-4 rounded-full border" />} label={label} theme={theme} />)}</div>{paymentMethod === 'cash' && <label className="mt-3"><span>Troco para quanto? (opcional)</span><input inputMode="decimal" value={changeFor} onChange={(e) => setChangeFor(e.target.value)} placeholder="Ex.: 100,00" /></label>}<p className="mt-2 text-xs opacity-55">O pedido fica aguardando a confirmação do pagamento pela loja.</p></fieldset>
          {checkoutError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{checkoutError}</div>}
        </div><div className="border-t border-black/10 bg-white p-5"><div className="space-y-1 text-sm"><div className="flex justify-between"><span>Itens</span><span>{money.format(subtotal)}</span></div><div className="flex justify-between"><span>Entrega</span><span>{orderType === 'delivery' ? money.format(deliveryFee) : 'Grátis'}</span></div><div className="flex justify-between pt-2 text-xl"><strong>Total</strong><strong>{money.format(total)}</strong></div></div><button type="submit" disabled={submitting || !menu.status.open} className="mt-4 w-full justify-center rounded-xl py-4 text-base font-extrabold text-white" style={{ backgroundColor: theme.primaryColor }}>{submitting ? 'Enviando pedido...' : 'Fazer pedido'} <ShoppingBag className="h-5 w-5" /></button></div></form>}
      </aside></div>}
    </div>
  )
}

function ProductCard({ product, theme, onClick, favorite = false, onFavorite }: { product: Product; theme: StorefrontTheme; onClick: () => void; favorite?: boolean; onFavorite?: () => void }) {
  return <article className="group relative overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-lg"><button type="button" onClick={onClick} className="block w-full !rounded-none !p-0 text-left"><div className="relative aspect-[1.08] overflow-hidden"><ProductImage product={product} className="transition duration-300 group-hover:scale-105" />{product.featured && <span className="absolute left-2 top-2 rounded-full px-2 py-1 text-[9px] font-extrabold uppercase" style={{ backgroundColor: theme.accentColor, color: theme.primaryColor }}>Popular</span>}</div><div className="p-3"><h3 className="line-clamp-2 min-h-10 text-sm font-extrabold sm:text-base">{product.name}</h3><p className="mt-1 line-clamp-2 min-h-8 text-[11px] opacity-55 sm:text-xs">{product.description || 'Uma escolha deliciosa para o seu pedido.'}</p><div className="mt-3 flex items-center justify-between"><strong className="text-base" style={{ color: theme.primaryColor }}>{money.format(Number(product.price))}</strong><span className="grid h-9 w-9 place-items-center rounded-full text-white" style={{ backgroundColor: theme.primaryColor }}><Plus className="h-5 w-5" /></span></div></div></button>{onFavorite && <button type="button" onClick={(event) => { event.stopPropagation(); onFavorite() }} aria-label={favorite ? `Remover ${product.name} dos favoritos` : `Favoritar ${product.name}`} className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow"><Heart className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} style={{ color: theme.primaryColor }} /></button>}</article>
}

function BottomAction({ label, icon, onClick, theme, active = false, badge = 0 }: { label: string; icon: React.ReactNode; onClick: () => void; theme: StorefrontTheme; active?: boolean; badge?: number }) {
  return <button type="button" onClick={onClick} className="relative flex flex-col items-center justify-center gap-1 !p-1 text-[10px] font-semibold" style={{ color: active ? theme.primaryColor : '#7c7077' }}>{icon}<span>{label}</span>{badge > 0 && <span className="absolute right-[21%] top-0 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold" style={{ backgroundColor: theme.accentColor, color: theme.primaryColor }}>{badge}</span>}</button>
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-black/10 p-3"><p className="text-[10px] font-bold uppercase tracking-wider opacity-45">{label}</p><p className="mt-1 text-sm font-semibold">{value || 'Ainda não informado'}</p></div>
}

function Choice({ active, onClick, icon, label, theme }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; theme: StorefrontTheme }) {
  return <button type="button" onClick={onClick} className="justify-center rounded-xl border px-3 py-3 text-sm font-bold" style={{ borderColor: active ? theme.primaryColor : '#e5e7eb', backgroundColor: active ? `${theme.primaryColor}10` : '#fff', color: active ? theme.primaryColor : 'inherit' }}>{icon}{label}</button>
}

function ProductDialog({ product, theme, quantity, setQuantity, selectedProteinId, setSelectedProteinId, addonQty, setAddonQty, itemNotes, setItemNotes, error, onClose, onAdd }: {
  product: Product; theme: StorefrontTheme; quantity: number; setQuantity: (value: number) => void
  selectedProteinId: string; setSelectedProteinId: (value: string) => void
  addonQty: Record<string, number>; setAddonQty: React.Dispatch<React.SetStateAction<Record<string, number>>>
  itemNotes: string; setItemNotes: (value: string) => void; error: string; onClose: () => void; onAdd: () => void
}) {
  const groups = [...new Set(product.addons.map((addon) => addon.groupName))]
  const extras = product.addons.reduce((sum, addon) => sum + Number(addon.price) * (addonQty[addon.id] ?? 0), 0)
  return <div className="fixed inset-0 z-50 grid place-items-end bg-black/50 sm:place-items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><div className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]"><div className="relative aspect-[1.9] overflow-hidden"><ProductImage product={product} /><button type="button" onClick={onClose} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white shadow"><X className="h-5 w-5" /></button></div><div className="space-y-5 p-5 sm:p-6"><div><h2 className="text-2xl font-extrabold">{product.name}</h2><p className="mt-1 text-sm opacity-60">{product.description}</p><p className="mt-2 text-xl font-extrabold" style={{ color: theme.primaryColor }}>{money.format(Number(product.price))}</p></div>
    {product.productType === 'combo' && (product.comboOptions?.length ?? 0) > 0 && <fieldset><legend className="mb-2 font-bold">{product.comboOptions?.[0]?.group ? `Escolha: ${product.comboOptions[0].group}` : 'Escolha uma opção'}</legend><div className="space-y-2">{product.comboOptions!.map((option) => <label key={option.ingredientId} className="flex cursor-pointer items-center gap-3 rounded-xl border p-3"><input type="radio" name="main-option" checked={selectedProteinId === option.ingredientId} onChange={() => setSelectedProteinId(option.ingredientId ?? '')} className="h-4 w-4" /><span className="font-medium">{option.label}</span></label>)}</div></fieldset>}
    {groups.map((group) => { const items = product.addons.filter((addon) => addon.groupName === group); return <fieldset key={group}><legend className="mb-2 font-bold">{group} {items.some((addon) => addon.required) && <span className="text-xs text-red-600">obrigatório</span>}</legend><div className="space-y-2">{items.map((addon) => <div key={addon.id} className="flex items-center justify-between rounded-xl border p-3"><div><p className="font-medium">{addon.name}</p><p className="text-xs opacity-60">+ {money.format(Number(addon.price))}</p></div><span className="flex items-center gap-1 rounded-full bg-black/5"><button type="button" onClick={() => setAddonQty((current) => ({ ...current, [addon.id]: Math.max(0, (current[addon.id] ?? 0) - 1) }))} className="grid h-8 w-8 place-items-center"><Minus className="h-3.5 w-3.5" /></button><strong className="w-5 text-center text-sm">{addonQty[addon.id] ?? 0}</strong><button type="button" onClick={() => setAddonQty((current) => ({ ...current, [addon.id]: Math.min(addon.maxQuantity, (current[addon.id] ?? 0) + 1) }))} className="grid h-8 w-8 place-items-center"><Plus className="h-3.5 w-3.5" /></button></span></div>)}</div></fieldset> })}
    <label><span>Alguma observação?</span><textarea value={itemNotes} onChange={(e) => setItemNotes(e.target.value)} maxLength={300} placeholder="Ex.: sem cebola, molho separado..." /></label>{error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="flex items-center gap-3 border-t pt-4"><span className="flex items-center gap-1 rounded-full bg-black/5"><button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))} className="grid h-10 w-10 place-items-center"><Minus className="h-4 w-4" /></button><strong className="w-6 text-center">{quantity}</strong><button type="button" onClick={() => setQuantity(Math.min(20, quantity + 1))} className="grid h-10 w-10 place-items-center"><Plus className="h-4 w-4" /></button></span><button type="button" onClick={onAdd} className="flex-1 justify-center rounded-xl py-3 font-extrabold text-white" style={{ backgroundColor: theme.primaryColor }}>Adicionar · {money.format((Number(product.price) + extras) * quantity)}</button></div></div></div></div>
}
