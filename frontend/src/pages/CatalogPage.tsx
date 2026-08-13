import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Boxes,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  FolderPlus,
  Image as ImageIcon,
  Layers3,
  Loader2,
  Package,
  Plus,
  Search,
  Store,
  Palette,
  Tags,
} from 'lucide-react'

import { useAuth } from '../context/AuthContext'
import { useTenant } from '../context/TenantContext'
import { apiGet, apiPost, apiPut, errorMessage } from '../lib/api'

interface MenuCategory {
  id: string
  name: string
  active: boolean
  _count?: { products: number }
}

interface Product {
  id: string
  name: string
  description?: string | null
  sku: string
  price: number | string
  costPrice: number | string
  stock: number
  active: boolean
  imageUrl?: string | null
  featured: boolean
  menuCategory?: { id: string; name: string } | null
  category?: string | null
}

interface SalesChannel {
  id: string
  name: string
  active: boolean
  platformFeePerc: number | string
  manualMultiplier: number | string
}

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function productMargin(product: Product) {
  const price = Number(product.price)
  const cost = Number(product.costPrice)
  return price > 0 ? ((price - cost) / price) * 100 : 0
}

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Package
  label: string
  value: number
  detail: string
  tone: 'brand' | 'good' | 'warn' | 'plum'
}) {
  const toneClass = {
    brand: 'bg-brand-soft text-accent',
    good: 'bg-good-soft text-good',
    warn: 'bg-warn-soft text-warn',
    plum: 'bg-[#f2eaf0] text-plum',
  }[tone]

  return (
    <article className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-sm">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${toneClass}`}>
        <Icon aria-hidden="true" className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold text-plum tabular">{value}</p>
        <p className="truncate text-xs text-slate">{detail}</p>
      </div>
    </article>
  )
}

export default function CatalogPage() {
  const navigate = useNavigate()
  const { activeTenant } = useTenant()
  const { can } = useAuth()
  const canManage = can('products:manage')
  const canSeePricing = can('pricing:view')

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [channels, setChannels] = useState<SalesChannel[]>([])
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [categoryName, setCategoryName] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)

  const loadCatalog = useCallback(async () => {
    if (!activeTenant?.id) return
    setLoading(true)
    setError('')
    try {
      const [productData, categoryData] = await Promise.all([
        apiGet<Product[]>('/api/products'),
        apiGet<MenuCategory[]>('/api/menu/categories'),
      ])
      setProducts(productData)
      setCategories(categoryData)

      if (canSeePricing) {
        apiGet<SalesChannel[]>('/api/pricing/channels')
          .then(setChannels)
          .catch(() => setChannels([]))
      } else {
        setChannels([])
      }
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível carregar o cardápio.'))
    } finally {
      setLoading(false)
    }
  }, [activeTenant?.id, canSeePricing])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return products.filter((product) => {
      const matchesCategory =
        activeCategory === 'all' || product.menuCategory?.id === activeCategory
      const matchesSearch =
        !term ||
        product.name.toLocaleLowerCase('pt-BR').includes(term) ||
        product.sku.toLocaleLowerCase('pt-BR').includes(term)
      return matchesCategory && matchesSearch
    })
  }, [activeCategory, products, search])

  const totals = useMemo(() => {
    const active = products.filter((product) => product.active).length
    return {
      total: products.length,
      active,
      paused: products.length - active,
      categories: categories.length,
    }
  }, [categories.length, products])

  async function toggleProduct(product: Product) {
    if (!canManage) return
    setSavingId(product.id)
    setError('')
    try {
      await apiPut(`/api/products/${product.id}`, { active: !product.active })
      setProducts((current) =>
        current.map((item) =>
          item.id === product.id ? { ...item, active: !item.active } : item,
        ),
      )
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível alterar a disponibilidade.'))
    } finally {
      setSavingId(null)
    }
  }

  async function createCategory(event: React.FormEvent) {
    event.preventDefault()
    const name = categoryName.trim()
    if (!name) return

    setSavingCategory(true)
    setError('')
    try {
      await apiPost('/api/menu/categories', { name, active: true })
      setCategoryName('')
      setShowCategoryForm(false)
      await loadCatalog()
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível criar a categoria.'))
    } finally {
      setSavingCategory(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-accent uppercase">
            Produtos e disponibilidade
          </p>
          <h2 className="font-display text-3xl text-plum">Cardápio</h2>
          <p className="mt-1 text-sm text-slate">
            Organize o que aparece no PDV e nos seus canais de venda.
          </p>
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate('/cardapio/loja-digital')}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-sm transition-colors hover:border-brand"
            >
              <Palette aria-hidden="true" className="h-4 w-4" />
              Loja digital
            </button>
            <button
              type="button"
              onClick={() => setShowCategoryForm(true)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-sm transition-colors hover:border-brand"
            >
              <FolderPlus aria-hidden="true" className="h-4 w-4" />
              Nova categoria
            </button>
            <button
              type="button"
              onClick={() => navigate('/cardapio/produtos/novo')}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-plum px-4 text-sm font-semibold text-cream shadow-sm transition-colors hover:bg-plum-soft"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Novo produto
            </button>
          </div>
        )}
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-bad/25 bg-bad-soft px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Boxes} label="Produtos" value={totals.total} detail="Total cadastrado" tone="brand" />
        <KpiCard icon={CheckCircle2} label="Ativos" value={totals.active} detail="Disponíveis para venda" tone="good" />
        <KpiCard icon={CirclePause} label="Pausados" value={totals.paused} detail="Fora dos canais" tone="warn" />
        <KpiCard icon={Layers3} label="Categorias" value={totals.categories} detail="Organização do cardápio" tone="plum" />
      </section>

      <section className="grid min-h-[540px] gap-4 xl:grid-cols-[220px_minmax(0,1fr)_260px]">
        <aside className="flex flex-col rounded-card border border-line bg-surface shadow-sm">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Categorias</h3>
          </div>
          <div className="flex flex-1 flex-col gap-1 p-2.5">
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                activeCategory === 'all'
                  ? 'bg-brand-soft font-semibold text-accent'
                  : 'text-ink hover:bg-canvas'
              }`}
            >
              <span className="flex items-center gap-2"><Tags className="h-4 w-4" />Todos</span>
              <span className="tabular text-xs text-slate">{products.length}</span>
            </button>
            {categories.map((category) => (
              <button
                type="button"
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  activeCategory === category.id
                    ? 'bg-brand-soft font-semibold text-accent'
                    : 'text-ink hover:bg-canvas'
                }`}
              >
                <span className="truncate">{category.name}</span>
                <span className="tabular text-xs text-slate">{category._count?.products ?? 0}</span>
              </button>
            ))}
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowCategoryForm(true)}
              className="m-3 inline-flex items-center justify-center gap-2 rounded-lg border border-brand px-3 py-2 text-sm font-semibold text-accent hover:bg-brand-soft"
            >
              <Plus className="h-4 w-4" /> Nova categoria
            </button>
          )}
        </aside>

        <div className="min-w-0 overflow-hidden rounded-card border border-line bg-surface shadow-sm">
          <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block w-full max-w-md">
              <Search aria-hidden="true" className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar produto ou SKU"
                className="h-10 w-full rounded-lg border border-line bg-canvas pr-3 pl-10 text-sm text-ink outline-none placeholder:text-slate/70 focus:border-brand"
              />
            </label>
            <p className="shrink-0 text-xs text-slate">
              {filteredProducts.length} {filteredProducts.length === 1 ? 'produto' : 'produtos'}
            </p>
          </div>

          {loading ? (
            <div className="flex min-h-[400px] items-center justify-center gap-2 text-sm text-slate">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Carregando cardápio...
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex min-h-[400px] flex-col items-center justify-center gap-2 px-6 text-center">
              <Package aria-hidden="true" className="h-8 w-8 text-slate/50" />
              <p className="font-medium text-ink">Nenhum produto encontrado</p>
              <p className="max-w-sm text-sm text-slate">
                Ajuste a busca ou cadastre o primeiro produto desta categoria.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="bg-canvas text-xs text-slate">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Produto</th>
                    <th className="px-3 py-3 font-semibold">SKU</th>
                    <th className="px-3 py-3 font-semibold">Categoria</th>
                    <th className="px-3 py-3 text-right font-semibold">Custo</th>
                    <th className="px-3 py-3 text-right font-semibold">Preço</th>
                    <th className="px-3 py-3 text-right font-semibold">Margem</th>
                    <th className="px-3 py-3 text-right font-semibold">Estoque</th>
                    <th className="px-4 py-3 text-center font-semibold">Ativo</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => {
                    const margin = productMargin(product)
                    const marginClass = margin >= 40 ? 'text-good' : margin >= 20 ? 'text-warn' : 'text-bad'
                    return (
                      <tr key={product.id} className="border-t border-line transition-colors hover:bg-canvas/70">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-canvas text-slate/50">
                              {product.imageUrl ? (
                                <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <ImageIcon aria-hidden="true" className="h-5 w-5" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => navigate(`/cardapio/produtos/${product.id}`)}
                                className="block max-w-full truncate text-left font-semibold text-ink hover:text-accent hover:underline"
                              >
                                {product.name}
                              </button>
                              <p className="truncate text-xs text-slate">{product.description || 'Sem descrição'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-slate">{product.sku}</td>
                        <td className="px-3 py-3 text-slate">{product.menuCategory?.name || product.category || 'Sem categoria'}</td>
                        <td className="px-3 py-3 text-right text-slate">{money.format(Number(product.costPrice))}</td>
                        <td className="px-3 py-3 text-right font-semibold text-ink">{money.format(Number(product.price))}</td>
                        <td className={`px-3 py-3 text-right font-semibold ${marginClass}`}>{margin.toFixed(1)}%</td>
                        <td className={`px-3 py-3 text-right ${product.stock <= 0 ? 'font-semibold text-bad' : 'text-ink'}`}>{product.stock}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={product.active}
                            aria-label={`${product.active ? 'Pausar' : 'Ativar'} ${product.name}`}
                            disabled={!canManage || savingId === product.id}
                            onClick={() => void toggleProduct(product)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${product.active ? 'bg-good' : 'bg-slate/35'}`}
                          >
                            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${product.active ? 'translate-x-6' : 'translate-x-1'}`} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="flex h-fit flex-col rounded-card border border-line bg-surface shadow-sm">
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink">Canais de venda</h3>
            <p className="mt-0.5 text-xs text-slate">Disponibilidade e taxas</p>
          </div>
          <div className="flex flex-col gap-2 p-3">
            <div className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f2eaf0] text-plum"><Store className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">Loja própria</p>
                  <p className="text-xs text-good">Disponível</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate" />
              </div>
              <div className="mt-3 flex justify-between border-t border-line pt-2 text-xs text-slate">
                <span>Ajuste de preço</span><strong className="text-ink">0%</strong>
              </div>
            </div>

            {channels.map((channel) => (
              <div key={channel.id} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-accent"><Tags className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{channel.name}</p>
                    <p className={`text-xs ${channel.active ? 'text-good' : 'text-slate'}`}>{channel.active ? 'Ativo' : 'Pausado'}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate" />
                </div>
                <div className="mt-3 flex justify-between border-t border-line pt-2 text-xs text-slate">
                  <span>Taxa do canal</span><strong className="text-ink">{Number(channel.platformFeePerc).toFixed(1)}%</strong>
                </div>
              </div>
            ))}

            {!canSeePricing && (
              <p className="rounded-lg bg-canvas px-3 py-2 text-xs leading-relaxed text-slate">
                As taxas dos marketplaces ficam disponíveis para perfis com acesso à precificação.
              </p>
            )}
          </div>
        </aside>
      </section>

      {showCategoryForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="presentation">
          <form onSubmit={createCategory} className="w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-xl">
            <div className="mb-5 flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-accent"><FolderPlus className="h-5 w-5" /></span>
              <div>
                <h3 className="font-display text-xl text-plum">Nova categoria</h3>
                <p className="mt-1 text-sm text-slate">Agrupe produtos para facilitar a venda e a navegação.</p>
              </div>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
              Nome da categoria
              <input
                autoFocus
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="Ex.: Combos, Bebidas, Sobremesas"
                className="h-11 rounded-lg border border-line bg-canvas px-3 text-sm outline-none placeholder:text-slate/60 focus:border-brand"
              />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setShowCategoryForm(false)} className="h-10 rounded-lg border border-line px-4 text-sm font-semibold text-ink hover:bg-canvas">Cancelar</button>
              <button disabled={!categoryName.trim() || savingCategory} className="inline-flex h-10 items-center gap-2 rounded-lg bg-plum px-4 text-sm font-semibold text-cream disabled:opacity-60">
                {savingCategory && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar categoria
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
