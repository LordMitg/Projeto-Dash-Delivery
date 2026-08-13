import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Image as ImageIcon,
  Layers3,
  Loader2,
  PackagePlus,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { ImageUploadField } from '../components/ImageUploadField'
import { useAuth } from '../context/AuthContext'
import { useTenant } from '../context/TenantContext'
import { apiDelete, apiGet, apiPost, apiPut, errorMessage } from '../lib/api'

type Tab = 'information' | 'recipe' | 'pricing' | 'addons'

interface MenuCategory {
  id: string
  name: string
}

interface Ingredient {
  id: string
  name: string
  unit: string
  price: number | string
  breakageFactor: number | string
  active: boolean
}

interface RecipeLine {
  ingredientId: string
  quantity: number
  isMainProtein: boolean
  isPackaging: boolean
}

interface CmvResult {
  ingredientCost: number
  laborCost: number
  packagingCost: number
  totalCostPrice: number
  margin: number
  lines: Array<{
    ingredientId: string
    ingredientName: string
    unit: string
    unitPrice: number
    breakageFactor: number
    lineCost: number
  }>
}

interface ProductResponse {
  id: string
  name: string
  description?: string | null
  sku: string
  price: number | string
  laborCost: number | string
  category?: string | null
  productType: string
  barcode?: string | null
  imageUrl?: string | null
  menuCategoryId?: string | null
  sortOrder: number
  featured: boolean
  active: boolean
  technicalSheet: Array<{
    ingredientId: string
    quantity: number | string
    isMainProtein: boolean
    isPackaging: boolean
  }>
  cmv?: CmvResult
}

interface ProductAddon {
  id: string
  name: string
  price: number | string
  groupName: string
  required: boolean
  maxQuantity: number
  active: boolean
}

interface ProductForm {
  name: string
  sku: string
  description: string
  price: number
  laborCost: number
  category: string
  productType: string
  barcode: string
  imageUrl: string
  menuCategoryId: string
  sortOrder: number
  featured: boolean
  active: boolean
}

const emptyForm: ProductForm = {
  name: '',
  sku: '',
  description: '',
  price: 0,
  laborCost: 0,
  category: '',
  productType: 'simple',
  barcode: '',
  imageUrl: '',
  menuCategoryId: '',
  sortOrder: 0,
  featured: false,
  active: true,
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const fieldClass =
  'h-11 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink outline-none transition-colors placeholder:text-slate/60 focus:border-brand disabled:cursor-not-allowed disabled:opacity-60'

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-sm">
      <div className="mb-5">
        <h3 className="font-display text-xl text-plum">{title}</h3>
        {description && <p className="mt-1 text-sm text-slate">{description}</p>}
      </div>
      {children}
    </section>
  )
}

export default function ProductEditorPage() {
  const { id } = useParams<{ id: string }>()
  const isNew = !id || id === 'novo'
  const navigate = useNavigate()
  const { can } = useAuth()
  const { activeTenant } = useTenant()
  const canManage = can('products:manage')

  const [tab, setTab] = useState<Tab>('information')
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [recipe, setRecipe] = useState<RecipeLine[]>([])
  const [addons, setAddons] = useState<ProductAddon[]>([])
  const [cmv, setCmv] = useState<CmvResult>({
    ingredientCost: 0,
    laborCost: 0,
    packagingCost: 0,
    totalCostPrice: 0,
    margin: 0,
    lines: [],
  })
  const [loading, setLoading] = useState(true)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [addonDraft, setAddonDraft] = useState({
    name: '',
    groupName: 'Adicionais',
    price: 0,
    maxQuantity: 1,
    required: false,
  })

  const load = useCallback(async () => {
    if (!activeTenant?.id) return
    setLoading(true)
    setError('')
    try {
      const [categoryData, ingredientData] = await Promise.all([
        apiGet<MenuCategory[]>('/api/menu/categories'),
        apiGet<Ingredient[]>('/api/ingredients'),
      ])
      setCategories(categoryData)
      setIngredients(ingredientData.filter((ingredient) => ingredient.active))

      if (isNew) {
        setForm(emptyForm)
        setRecipe([])
        setAddons([])
        setCmv((current) => ({ ...current, totalCostPrice: 0, margin: 0, lines: [] }))
      } else {
        const [product, addonData] = await Promise.all([
          apiGet<ProductResponse>(`/api/products/${id}`),
          apiGet<ProductAddon[]>('/api/menu/addons', { productId: id }),
        ])
        setForm({
          name: product.name,
          sku: product.sku,
          description: product.description || '',
          price: Number(product.price),
          laborCost: Number(product.laborCost),
          category: product.category || '',
          productType: product.productType || 'simple',
          barcode: product.barcode || '',
          imageUrl: product.imageUrl || '',
          menuCategoryId: product.menuCategoryId || '',
          sortOrder: product.sortOrder || 0,
          featured: product.featured,
          active: product.active,
        })
        setRecipe(
          product.technicalSheet.map((line) => ({
            ingredientId: line.ingredientId,
            quantity: Number(line.quantity),
            isMainProtein: line.isMainProtein,
            isPackaging: line.isPackaging,
          })),
        )
        if (product.cmv) setCmv(product.cmv)
        setAddons(addonData)
      }
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível abrir o produto.'))
    } finally {
      setLoading(false)
    }
  }, [activeTenant?.id, id, isNew])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (loading) return
    const timer = window.setTimeout(async () => {
      setPreviewing(true)
      try {
        const result = await apiPost<CmvResult>('/api/products/preview-cmv', {
          technicalSheet: recipe,
          laborCost: form.laborCost,
          salePrice: form.price,
        })
        setCmv(result)
      } catch {
        // A falha de prévia não apaga os dados nem impede o preenchimento.
      } finally {
        setPreviewing(false)
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [form.laborCost, form.price, loading, recipe])

  const selectedCategory = categories.find((category) => category.id === form.menuCategoryId)
  const suggestedPrice = cmv.totalCostPrice > 0 ? cmv.totalCostPrice / 0.45 : 0
  const marginTone = cmv.margin >= 55 ? 'text-good' : cmv.margin >= 30 ? 'text-warn' : 'text-bad'

  const tabs = useMemo(
    () => [
      { id: 'information' as const, label: 'Informações', icon: ClipboardList },
      { id: 'recipe' as const, label: 'Receita e custos', icon: Layers3 },
      { id: 'pricing' as const, label: 'Precificação', icon: CircleDollarSign },
      { id: 'addons' as const, label: `Adicionais${addons.length ? ` (${addons.length})` : ''}`, icon: PackagePlus },
    ],
    [addons.length],
  )

  function updateForm<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setMessage('')
  }

  function addRecipeLine() {
    const available = ingredients.find(
      (ingredient) => !recipe.some((line) => line.ingredientId === ingredient.id),
    )
    if (!available) return
    setRecipe((current) => [
      ...current,
      { ingredientId: available.id, quantity: 1, isMainProtein: false, isPackaging: false },
    ])
  }

  function updateRecipeLine(index: number, patch: Partial<RecipeLine>) {
    setRecipe((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    )
  }

  async function saveProduct() {
    if (!canManage || saving) return
    setError('')
    setMessage('')
    if (!form.name.trim() || !form.sku.trim()) {
      setError('Preencha o nome e o SKU do produto.')
      setTab('information')
      return
    }
    if (form.price <= 0) {
      setError('Informe um preço de venda maior que zero.')
      setTab('pricing')
      return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        category: selectedCategory?.name || form.category || null,
        menuCategoryId: form.menuCategoryId || null,
        technicalSheet: recipe,
      }
      if (isNew) {
        const result = await apiPost<{ product: { id: string } }>('/api/products', payload)
        navigate(`/cardapio/produtos/${result.product.id}`, { replace: true })
      } else {
        await apiPut(`/api/products/${id}`, payload)
        setMessage('Produto e ficha técnica salvos com sucesso.')
        await load()
      }
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar o produto.'))
    } finally {
      setSaving(false)
    }
  }

  async function createAddon(event: FormEvent) {
    event.preventDefault()
    if (!id || !addonDraft.name.trim()) return
    setSaving(true)
    setError('')
    try {
      await apiPost('/api/menu/addons', { ...addonDraft, productId: id, active: true })
      setAddonDraft({ name: '', groupName: 'Adicionais', price: 0, maxQuantity: 1, required: false })
      setAddons(await apiGet<ProductAddon[]>('/api/menu/addons', { productId: id }))
      setMessage('Adicional criado com sucesso.')
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível criar o adicional.'))
    } finally {
      setSaving(false)
    }
  }

  async function removeAddon(addonId: string) {
    if (!canManage) return
    setError('')
    try {
      await apiDelete(`/api/menu/addons/${addonId}`)
      setAddons((current) => current.filter((addon) => addon.id !== addonId))
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível remover o adicional.'))
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[520px] items-center justify-center gap-2 text-sm text-slate">
        <Loader2 className="h-5 w-5 animate-spin" /> Abrindo editor do produto...
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => navigate('/cardapio')}
            aria-label="Voltar ao cardápio"
            className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-slate hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
              Cardápio / {isNew ? 'Novo produto' : form.name}
            </p>
            <h2 className="mt-1 font-display text-3xl text-plum">
              {isNew ? 'Cadastrar produto' : 'Ficha técnica e precificação'}
            </h2>
            <p className="mt-1 text-sm text-slate">
              {isNew ? 'Cadastre o item completo em um único fluxo.' : `${form.name} · ${form.sku}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!canManage && (
            <span className="rounded-lg bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">Somente leitura</span>
          )}
          <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={form.active}
              disabled={!canManage}
              onChange={(event) => updateForm('active', event.target.checked)}
              className="accent-[#2f7d42]"
            />
            Produto ativo
          </label>
          <button
            type="button"
            onClick={() => void saveProduct()}
            disabled={!canManage || saving}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-plum px-5 text-sm font-semibold text-cream shadow-sm hover:bg-plum-soft disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar alterações
          </button>
        </div>
      </header>

      {error && <div role="alert" className="rounded-lg border border-bad/25 bg-bad-soft px-4 py-3 text-sm text-bad">{error}</div>}
      {message && <div role="status" className="flex items-center gap-2 rounded-lg border border-good/25 bg-good-soft px-4 py-3 text-sm text-good"><CheckCircle2 className="h-4 w-4" />{message}</div>}

      <nav className="flex overflow-x-auto rounded-card border border-line bg-surface p-1 shadow-sm">
        {tabs.map(({ id: tabId, label, icon: Icon }) => (
          <button
            type="button"
            key={tabId}
            onClick={() => setTab(tabId)}
            className={`inline-flex min-w-fit flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-colors ${tab === tabId ? 'bg-brand-soft text-accent' : 'text-slate hover:bg-canvas hover:text-ink'}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </nav>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_310px] 2xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0">
          {tab === 'information' && (
            <SectionCard title="Informações do produto" description="Dados usados no PDV, no cardápio digital e nos canais de venda.">
              <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-ink sm:col-span-2">Nome do produto<input value={form.name} disabled={!canManage} onChange={(event) => updateForm('name', event.target.value)} placeholder="Ex.: Pudim tradicional 120 g" className={fieldClass} /></label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">SKU<input value={form.sku} disabled={!canManage} onChange={(event) => updateForm('sku', event.target.value.toUpperCase())} placeholder="PUD-TRAD-120" className={fieldClass} /></label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Código de barras<input value={form.barcode} disabled={!canManage} onChange={(event) => updateForm('barcode', event.target.value)} placeholder="7890000000000" className={fieldClass} /></label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Categoria<select value={form.menuCategoryId} disabled={!canManage} onChange={(event) => updateForm('menuCategoryId', event.target.value)} className={fieldClass}><option value="">Sem categoria</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Tipo<select value={form.productType} disabled={!canManage} onChange={(event) => updateForm('productType', event.target.value)} className={fieldClass}><option value="simple">Produto simples</option><option value="combo">Combo</option></select></label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium text-ink sm:col-span-2">Descrição<textarea value={form.description} disabled={!canManage} onChange={(event) => updateForm('description', event.target.value)} rows={4} placeholder="Descreva o produto para o cliente" className={`${fieldClass} h-auto resize-y py-3`} /></label>
                  <label className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" checked={form.featured} disabled={!canManage} onChange={(event) => updateForm('featured', event.target.checked)} className="accent-[#d4a017]" />Mostrar nos destaques</label>
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">Ordem<input type="number" value={form.sortOrder} disabled={!canManage} onChange={(event) => updateForm('sortOrder', Number(event.target.value))} className={`${fieldClass} w-24`} /></label>
                </div>
                <div className="rounded-card border border-line bg-canvas p-4">
                  {canManage ? <ImageUploadField value={form.imageUrl} onChange={(value) => updateForm('imageUrl', value)} label="Imagem do produto" /> : form.imageUrl ? <img src={form.imageUrl} alt={form.name} className="aspect-square w-full rounded-card object-cover" /> : <div className="flex aspect-square items-center justify-center rounded-card border border-dashed border-line text-slate"><ImageIcon className="h-8 w-8" /></div>}
                </div>
              </div>
            </SectionCard>
          )}

          {tab === 'recipe' && (
            <div className="flex flex-col gap-4">
              <SectionCard title="Ingredientes da receita" description="O custo é recalculado automaticamente com os preços atuais dos insumos.">
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-canvas text-xs text-slate"><tr><th className="px-3 py-3">Ingrediente</th><th className="px-3 py-3">Quantidade</th><th className="px-3 py-3">Custo</th><th className="px-3 py-3">Função</th><th className="w-12 px-3 py-3" /></tr></thead>
                    <tbody>
                      {recipe.map((line, index) => {
                        const ingredient = ingredients.find((item) => item.id === line.ingredientId)
                        const calculated = cmv.lines.find((item) => item.ingredientId === line.ingredientId)
                        return <tr key={`${line.ingredientId}-${index}`} className="border-t border-line"><td className="px-3 py-3"><select value={line.ingredientId} disabled={!canManage} onChange={(event) => updateRecipeLine(index, { ingredientId: event.target.value })} className={fieldClass}>{ingredients.map((item) => <option key={item.id} value={item.id} disabled={recipe.some((row, rowIndex) => rowIndex !== index && row.ingredientId === item.id)}>{item.name}</option>)}</select></td><td className="px-3 py-3"><div className="flex items-center gap-2"><input type="number" min="0.0001" step="0.0001" value={line.quantity} disabled={!canManage} onChange={(event) => updateRecipeLine(index, { quantity: Number(event.target.value) })} className={`${fieldClass} w-32`} /><span className="text-xs text-slate">{ingredient?.unit}</span></div></td><td className="px-3 py-3 font-semibold text-ink">{money.format(calculated?.lineCost ?? 0)}</td><td className="px-3 py-3"><label className="flex items-center gap-2 text-xs text-slate"><input type="checkbox" checked={line.isPackaging} disabled={!canManage} onChange={(event) => updateRecipeLine(index, { isPackaging: event.target.checked })} />Embalagem</label></td><td className="px-3 py-3"><button type="button" disabled={!canManage} onClick={() => setRecipe((current) => current.filter((_, rowIndex) => rowIndex !== index))} aria-label="Remover ingrediente" className="text-slate hover:text-bad disabled:opacity-50"><Trash2 className="h-4 w-4" /></button></td></tr>
                      })}
                    </tbody>
                  </table>
                  {!recipe.length && <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-slate"><Layers3 className="h-7 w-7 text-slate/50" /><p>Adicione os insumos usados para produzir uma unidade.</p></div>}
                </div>
                {canManage && <button type="button" onClick={addRecipeLine} disabled={recipe.length >= ingredients.length} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border border-brand px-4 text-sm font-semibold text-accent hover:bg-brand-soft disabled:opacity-50"><Plus className="h-4 w-4" />Adicionar ingrediente</button>}
              </SectionCard>
              <SectionCard title="Custos adicionais" description="Inclua o custo de mão de obra por unidade produzida."><label className="flex max-w-sm flex-col gap-1.5 text-sm font-medium text-ink">Mão de obra por unidade<input type="number" min="0" step="0.01" value={form.laborCost} disabled={!canManage} onChange={(event) => updateForm('laborCost', Number(event.target.value))} className={fieldClass} /></label></SectionCard>
            </div>
          )}

          {tab === 'pricing' && (
            <SectionCard title="Preço e margem" description="Defina o preço direto. O DeliOne mostra o efeito sobre a margem antes de salvar.">
              <div className="grid gap-4 md:grid-cols-3">
                <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Preço de venda<input type="number" min="0" step="0.01" value={form.price} disabled={!canManage} onChange={(event) => updateForm('price', Number(event.target.value))} className={fieldClass} /></label>
                <div className="rounded-lg bg-canvas p-4"><p className="text-xs text-slate">Custo total</p><p className="mt-1 text-xl font-semibold text-ink">{money.format(cmv.totalCostPrice)}</p></div>
                <div className="rounded-lg bg-canvas p-4"><p className="text-xs text-slate">Margem de contribuição</p><p className={`mt-1 text-xl font-semibold ${marginTone}`}>{cmv.margin.toFixed(1)}%</p></div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-lg border border-line p-4"><p className="text-xs text-slate">Ingredientes</p><p className="mt-1 font-semibold text-ink">{money.format(cmv.ingredientCost)}</p></div><div className="rounded-lg border border-line p-4"><p className="text-xs text-slate">Embalagem</p><p className="mt-1 font-semibold text-ink">{money.format(cmv.packagingCost)}</p></div><div className="rounded-lg border border-line p-4"><p className="text-xs text-slate">Mão de obra</p><p className="mt-1 font-semibold text-ink">{money.format(cmv.laborCost)}</p></div></div>
            </SectionCard>
          )}

          {tab === 'addons' && (
            <SectionCard title="Adicionais e opções" description="Complementos que o operador pode incluir no pedido pelo PDV.">
              {isNew ? <div className="rounded-lg border border-dashed border-line bg-canvas px-6 py-12 text-center"><PackagePlus className="mx-auto h-8 w-8 text-slate/50" /><p className="mt-3 font-semibold text-ink">Salve o produto primeiro</p><p className="mt-1 text-sm text-slate">Depois você poderá cadastrar adicionais ligados a ele.</p></div> : <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="flex flex-col gap-2">{addons.map((addon) => <div key={addon.id} className="flex items-center gap-3 rounded-lg border border-line p-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-accent"><Plus className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="font-semibold text-ink">{addon.name}</p><p className="text-xs text-slate">{addon.groupName} · até {addon.maxQuantity} · {addon.required ? 'obrigatório' : 'opcional'}</p></div><strong className="text-sm text-ink">{money.format(Number(addon.price))}</strong>{canManage && <button type="button" onClick={() => void removeAddon(addon.id)} aria-label={`Remover ${addon.name}`} className="text-slate hover:text-bad"><Trash2 className="h-4 w-4" /></button>}</div>)}{!addons.length && <p className="rounded-lg bg-canvas px-4 py-8 text-center text-sm text-slate">Nenhum adicional cadastrado.</p>}</div>{canManage && <form onSubmit={createAddon} className="flex flex-col gap-3 rounded-card border border-line bg-canvas p-4"><h4 className="font-semibold text-ink">Novo adicional</h4><label className="flex flex-col gap-1 text-xs font-medium text-slate">Nome<input value={addonDraft.name} onChange={(event) => setAddonDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Calda extra" className={fieldClass} /></label><label className="flex flex-col gap-1 text-xs font-medium text-slate">Grupo<input value={addonDraft.groupName} onChange={(event) => setAddonDraft((current) => ({ ...current, groupName: event.target.value }))} className={fieldClass} /></label><div className="grid grid-cols-2 gap-2"><label className="flex flex-col gap-1 text-xs font-medium text-slate">Preço<input type="number" min="0" step="0.01" value={addonDraft.price} onChange={(event) => setAddonDraft((current) => ({ ...current, price: Number(event.target.value) }))} className={fieldClass} /></label><label className="flex flex-col gap-1 text-xs font-medium text-slate">Máximo<input type="number" min="1" value={addonDraft.maxQuantity} onChange={(event) => setAddonDraft((current) => ({ ...current, maxQuantity: Number(event.target.value) }))} className={fieldClass} /></label></div><label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={addonDraft.required} onChange={(event) => setAddonDraft((current) => ({ ...current, required: event.target.checked }))} />Escolha obrigatória</label><button disabled={!addonDraft.name.trim() || saving} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-plum px-4 text-sm font-semibold text-cream disabled:opacity-50"><Plus className="h-4 w-4" />Criar adicional</button></form>}</div>}
            </SectionCard>
          )}
        </div>

        <aside className="sticky top-5 rounded-card border border-brand/30 bg-surface shadow-sm">
          <div className="flex items-center gap-3 border-b border-line p-5"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-accent"><Sparkles className="h-5 w-5" /></span><div><h3 className="font-display text-xl text-plum">Precificação inteligente</h3><p className="text-xs text-slate">Atualização em tempo real</p></div>{previewing && <Loader2 className="ml-auto h-4 w-4 animate-spin text-slate" />}</div>
          <div className="flex flex-col gap-5 p-5"><div><p className="text-sm text-slate">Custo por unidade</p><p className="mt-1 text-3xl font-semibold text-ink">{money.format(cmv.totalCostPrice)}</p></div><div><p className="text-sm text-slate">Preço atual</p><p className="mt-1 text-2xl font-semibold text-plum">{money.format(form.price)}</p></div><div className="border-t border-line pt-4"><div className="flex items-end justify-between"><p className="text-sm text-slate">Margem</p><strong className={`text-2xl ${marginTone}`}>{cmv.margin.toFixed(1)}%</strong></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-bad-soft"><div className={`h-full rounded-full ${cmv.margin >= 55 ? 'bg-good' : cmv.margin >= 30 ? 'bg-warn' : 'bg-bad'}`} style={{ width: `${Math.max(0, Math.min(100, cmv.margin))}%` }} /></div><div className="mt-1 flex justify-between text-[11px] text-slate"><span>0%</span><span>meta 55%</span><span>100%</span></div></div><div className="rounded-lg border border-brand/30 bg-brand-soft p-4"><p className="text-xs font-semibold tracking-wide text-accent uppercase">Preço sugerido para 55%</p><p className="mt-1 text-2xl font-semibold text-plum">{money.format(suggestedPrice)}</p><p className="mt-1 text-xs leading-relaxed text-slate">Cálculo baseado no custo atual, sem taxas específicas de marketplaces.</p></div>{canManage && suggestedPrice > 0 && <button type="button" onClick={() => updateForm('price', Number(suggestedPrice.toFixed(2)))} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-brand text-sm font-semibold text-accent hover:bg-brand-soft"><Sparkles className="h-4 w-4" />Aplicar preço sugerido</button>}</div>
        </aside>
      </div>
    </div>
  )
}
