import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Barcode,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Edit3,
  Filter,
  History,
  Loader2,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'

import { useAuth } from '../context/AuthContext'
import { useTenant } from '../context/TenantContext'
import { apiDelete, apiGet, apiPost, apiPut, errorMessage } from '../lib/api'

interface Ingredient {
  id: string
  name: string
  description?: string | null
  sku: string
  barcode?: string | null
  unit: string
  price: number | string
  breakageFactor: number | string
  stock: number | string
  minimumStock: number | string
  active: boolean
}

interface StockMovement {
  id: string
  type: string
  delta: number | string
  balanceBefore: number | string
  balanceAfter: number | string
  reason?: string | null
  createdAt: string
  ingredient: { id: string; name: string; unit: string; sku: string }
  actor?: { id: string; firstName: string; lastName: string } | null
}

interface IngredientForm {
  name: string
  description: string
  sku: string
  barcode: string
  unit: string
  price: string
  breakageFactor: string
  initialStock: string
  minimumStock: string
  active: boolean
}

const emptyIngredient: IngredientForm = {
  name: '',
  description: '',
  sku: '',
  barcode: '',
  unit: 'un',
  price: '',
  breakageFactor: '0',
  initialStock: '0',
  minimumStock: '0',
  active: true,
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 })
const fieldClass =
  'h-11 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink outline-none transition-colors placeholder:text-slate/60 focus:border-brand disabled:opacity-60'

const movementLabels: Record<string, string> = {
  entry: 'Entrada',
  exit: 'Saída',
  loss: 'Perda',
  adjustment: 'Ajuste',
  sale: 'Venda',
  return: 'Devolução',
  invoice: 'Nota fiscal',
  initial: 'Saldo inicial',
}

function stockStatus(ingredient: Ingredient) {
  const stock = Number(ingredient.stock)
  const minimum = Number(ingredient.minimumStock)
  if (!ingredient.active) return { label: 'Inativo', tone: 'bg-slate/10 text-slate' }
  if (stock <= 0) return { label: 'Ruptura', tone: 'bg-bad-soft text-bad' }
  if (minimum > 0 && stock <= minimum * 0.5) return { label: 'Crítico', tone: 'bg-bad-soft text-bad' }
  if (minimum > 0 && stock <= minimum) return { label: 'Baixo', tone: 'bg-warn-soft text-warn' }
  return { label: 'Normal', tone: 'bg-good-soft text-good' }
}

function Kpi({ icon: Icon, label, value, detail, tone }: {
  icon: typeof Boxes
  label: string
  value: string
  detail: string
  tone: 'brand' | 'bad' | 'warn' | 'good'
}) {
  const styles = {
    brand: 'bg-brand-soft text-accent',
    bad: 'bg-bad-soft text-bad',
    warn: 'bg-warn-soft text-warn',
    good: 'bg-good-soft text-good',
  }[tone]
  return (
    <article className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-sm">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${styles}`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0"><p className="text-xs font-medium text-slate">{label}</p><p className="mt-0.5 truncate text-xl font-semibold text-plum">{value}</p><p className="truncate text-xs text-slate">{detail}</p></div>
    </article>
  )
}

export const IngredientsManagement = () => {
  const navigate = useNavigate()
  const { currentTenant } = useTenant()
  const { can } = useAuth()
  const canManage = can('ingredients:manage')

  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'normal' | 'low' | 'critical' | 'inactive'>('all')
  const [tab, setTab] = useState<'stock' | 'movements'>('stock')
  const [showIngredientForm, setShowIngredientForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [ingredientForm, setIngredientForm] = useState<IngredientForm>(emptyIngredient)
  const [showMovementForm, setShowMovementForm] = useState(false)
  const [movementForm, setMovementForm] = useState({ ingredientId: '', type: 'entry', quantity: '', reason: '' })
  const [deleteTarget, setDeleteTarget] = useState<Ingredient | null>(null)

  const load = useCallback(async () => {
    if (!currentTenant?.id) return
    setLoading(true)
    setError('')
    try {
      const [ingredientData, movementData] = await Promise.all([
        apiGet<Ingredient[]>('/api/ingredients'),
        apiGet<StockMovement[]>('/api/ingredients/movements', { limit: 40 }),
      ])
      setIngredients(ingredientData)
      setMovements(movementData)
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível carregar o estoque.'))
    } finally {
      setLoading(false)
    }
  }, [currentTenant?.id])

  useEffect(() => { void load() }, [load])

  const metrics = useMemo(() => {
    const active = ingredients.filter((item) => item.active)
    const value = active.reduce((sum, item) => sum + Number(item.stock) * Number(item.price), 0)
    const ruptures = active.filter((item) => Number(item.stock) <= 0).length
    const low = active.filter((item) => Number(item.stock) > 0 && Number(item.minimumStock) > 0 && Number(item.stock) <= Number(item.minimumStock)).length
    const restockCost = active.reduce((sum, item) => {
      const minimum = Number(item.minimumStock)
      const suggested = minimum > 0 && Number(item.stock) <= minimum
        ? Math.max(0, minimum * 2 - Number(item.stock))
        : 0
      return sum + suggested * Number(item.price)
    }, 0)
    return { value, ruptures, low, restockCost }
  }, [ingredients])

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return ingredients.filter((item) => {
      const status = stockStatus(item).label
      const matchText = !term || item.name.toLocaleLowerCase('pt-BR').includes(term) || item.sku.toLocaleLowerCase('pt-BR').includes(term) || item.barcode?.includes(term)
      const matchFilter = filter === 'all' || (filter === 'normal' && status === 'Normal') || (filter === 'low' && status === 'Baixo') || (filter === 'critical' && ['Crítico', 'Ruptura'].includes(status)) || (filter === 'inactive' && status === 'Inativo')
      return matchText && matchFilter
    })
  }, [filter, ingredients, search])

  const suggestions = useMemo(() => ingredients
    .filter((item) => item.active && Number(item.minimumStock) > 0 && Number(item.stock) <= Number(item.minimumStock))
    .map((item) => {
      const quantity = Math.max(0, Number(item.minimumStock) * 2 - Number(item.stock))
      return { item, quantity, total: quantity * Number(item.price) }
    })
    .sort((a, b) => b.total - a.total), [ingredients])

  function openNewIngredient() {
    setEditingId(null)
    setIngredientForm(emptyIngredient)
    setShowIngredientForm(true)
    setNotice('')
  }

  function openEditIngredient(item: Ingredient) {
    setEditingId(item.id)
    setIngredientForm({
      name: item.name,
      description: item.description || '',
      sku: item.sku,
      barcode: item.barcode || '',
      unit: item.unit,
      price: String(item.price),
      breakageFactor: String(item.breakageFactor),
      initialStock: '0',
      minimumStock: String(item.minimumStock),
      active: item.active,
    })
    setShowIngredientForm(true)
    setNotice('')
  }

  function openMovement(item?: Ingredient, type = 'entry', quantity = '') {
    setMovementForm({ ingredientId: item?.id || ingredients[0]?.id || '', type, quantity, reason: '' })
    setShowMovementForm(true)
    setNotice('')
  }

  async function saveIngredient(event: FormEvent) {
    event.preventDefault()
    if (!ingredientForm.name.trim() || !ingredientForm.sku.trim() || !ingredientForm.price) {
      setError('Preencha nome, SKU e custo unitário.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: ingredientForm.name,
        description: ingredientForm.description || null,
        sku: ingredientForm.sku,
        barcode: ingredientForm.barcode || null,
        unit: ingredientForm.unit,
        price: Number(ingredientForm.price),
        breakageFactor: Number(ingredientForm.breakageFactor || 0),
        minimumStock: Number(ingredientForm.minimumStock || 0),
        active: ingredientForm.active,
        ...(!editingId ? { stock: Number(ingredientForm.initialStock || 0) } : {}),
      }
      if (editingId) await apiPut(`/api/ingredients/${editingId}`, payload)
      else await apiPost('/api/ingredients', payload)
      setShowIngredientForm(false)
      setNotice(editingId ? 'Insumo atualizado.' : 'Insumo criado com saldo inicial registrado.')
      await load()
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar o insumo.'))
    } finally {
      setSaving(false)
    }
  }

  async function saveMovement(event: FormEvent) {
    event.preventDefault()
    const quantity = Number(movementForm.quantity)
    if (!movementForm.ingredientId || quantity <= 0 || movementForm.reason.trim().length < 2) {
      setError('Escolha o insumo, informe uma quantidade e descreva o motivo.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const negative = movementForm.type === 'exit' || movementForm.type === 'loss'
      await apiPost(`/api/ingredients/${movementForm.ingredientId}/stock`, {
        type: movementForm.type,
        delta: negative ? -quantity : quantity,
        reason: movementForm.reason,
      })
      setShowMovementForm(false)
      setNotice('Movimentação registrada e saldo atualizado.')
      await load()
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível registrar a movimentação.'))
    } finally {
      setSaving(false)
    }
  }

  async function deleteIngredient() {
    if (!deleteTarget) return
    setSaving(true)
    setError('')
    try {
      const result = await apiDelete<{ deactivated?: boolean; message?: string }>(`/api/ingredients/${deleteTarget.id}`)
      setDeleteTarget(null)
      setNotice(result?.message || 'Insumo removido.')
      await load()
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível remover o insumo.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="mb-1 text-xs font-semibold tracking-[0.14em] text-accent uppercase">Estoque e compras</p><h2 className="font-display text-3xl text-plum">Estoque</h2><p className="mt-1 text-sm text-slate">Controle de insumos, embalagens e movimentações.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate('/scanner')} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink shadow-sm hover:border-brand"><Barcode className="h-4 w-4" />Ler código de barras</button>
          {canManage && <button type="button" onClick={() => openMovement()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-brand bg-surface px-4 text-sm font-semibold text-accent hover:bg-brand-soft"><Plus className="h-4 w-4" />Nova movimentação</button>}
          {canManage && <button type="button" onClick={openNewIngredient} className="inline-flex h-10 items-center gap-2 rounded-lg bg-plum px-4 text-sm font-semibold text-cream shadow-sm hover:bg-plum-soft"><Package className="h-4 w-4" />Novo insumo</button>}
        </div>
      </header>

      {error && <div role="alert" className="flex items-center justify-between rounded-lg border border-bad/25 bg-bad-soft px-4 py-3 text-sm text-bad"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Fechar erro"><X className="h-4 w-4" /></button></div>}
      {notice && <div role="status" className="flex items-center gap-2 rounded-lg border border-good/25 bg-good-soft px-4 py-3 text-sm text-good"><CheckCircle2 className="h-4 w-4" />{notice}</div>}

      <nav className="flex overflow-x-auto border-b border-line">
        <button type="button" onClick={() => setTab('stock')} className={`min-w-fit border-b-2 px-4 py-3 text-sm font-semibold ${tab === 'stock' ? 'border-brand text-accent' : 'border-transparent text-slate'}`}>Estoque atual</button>
        <button type="button" onClick={() => setTab('movements')} className={`min-w-fit border-b-2 px-4 py-3 text-sm font-semibold ${tab === 'movements' ? 'border-brand text-accent' : 'border-transparent text-slate'}`}>Movimentações</button>
        <span className="min-w-fit px-4 py-3 text-sm text-slate/55" title="Entrará na próxima fatia">Inventário · em breve</span>
        <span className="min-w-fit px-4 py-3 text-sm text-slate/55" title="Entrará na fase de Compras">Compras · em breve</span>
      </nav>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Boxes} label="Valor em estoque" value={money.format(metrics.value)} detail={`${ingredients.filter((item) => item.active).length} insumos ativos`} tone="brand" />
        <Kpi icon={ClipboardList} label="Itens baixos" value={String(metrics.low)} detail="Abaixo ou no estoque mínimo" tone="warn" />
        <Kpi icon={AlertTriangle} label="Rupturas" value={String(metrics.ruptures)} detail="Sem saldo disponível" tone="bad" />
        <Kpi icon={ShoppingCart} label="Reposição estimada" value={money.format(metrics.restockCost)} detail="Para atingir 2× o mínimo" tone="good" />
      </section>

      {tab === 'stock' ? (
        <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0 overflow-hidden rounded-card border border-line bg-surface shadow-sm">
            <div className="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center">
              <label className="relative block min-w-0 flex-1"><Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate" /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar insumo, SKU ou código" className="h-10 w-full rounded-lg border border-line bg-canvas pr-3 pl-10 text-sm outline-none focus:border-brand" /></label>
              <label className="relative flex items-center gap-2"><Filter className="h-4 w-4 text-slate" /><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink"><option value="all">Todos os status</option><option value="normal">Normal</option><option value="low">Baixo</option><option value="critical">Crítico e ruptura</option><option value="inactive">Inativo</option></select></label>
              <span className="text-xs text-slate">{filtered.length} itens</span>
            </div>
            {loading ? <div className="flex min-h-[420px] items-center justify-center gap-2 text-sm text-slate"><Loader2 className="h-4 w-4 animate-spin" />Carregando estoque...</div> : filtered.length === 0 ? <div className="flex min-h-[420px] flex-col items-center justify-center gap-2 px-6 text-center"><Boxes className="h-8 w-8 text-slate/40" /><p className="font-semibold text-ink">Nenhum item encontrado</p><p className="text-sm text-slate">Ajuste os filtros ou cadastre o primeiro insumo.</p></div> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-canvas text-xs text-slate"><tr><th className="px-4 py-3">Insumo</th><th className="px-3 py-3">Estoque atual</th><th className="px-3 py-3">Mínimo</th><th className="px-3 py-3 text-right">Custo unitário</th><th className="px-3 py-3 text-right">Valor</th><th className="px-3 py-3 text-center">Status</th><th className="w-24 px-4 py-3 text-right">Ações</th></tr></thead><tbody>{filtered.map((item) => {
                const status = stockStatus(item)
                const current = Number(item.stock)
                const minimum = Number(item.minimumStock)
                const bar = minimum > 0 ? Math.min(100, Math.max(0, current / (minimum * 2) * 100)) : current > 0 ? 100 : 0
                return <tr key={item.id} className="border-t border-line hover:bg-canvas/70"><td className="px-4 py-3"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-accent"><Package className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate font-semibold text-ink">{item.name}</p><p className="truncate font-mono text-[11px] text-slate">{item.sku}{item.barcode ? ` · ${item.barcode}` : ''}</p></div></div></td><td className="px-3 py-3"><div className="flex items-center gap-3"><strong className="w-20 text-right tabular text-ink">{number.format(current)} {item.unit}</strong><div className="h-1.5 w-20 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${status.label === 'Normal' ? 'bg-good' : status.label === 'Baixo' ? 'bg-warn' : 'bg-bad'}`} style={{ width: `${bar}%` }} /></div></div></td><td className="px-3 py-3 text-slate">{number.format(minimum)} {item.unit}</td><td className="px-3 py-3 text-right text-slate">{money.format(Number(item.price))}</td><td className="px-3 py-3 text-right font-semibold text-ink">{money.format(current * Number(item.price))}</td><td className="px-3 py-3 text-center"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-1">{canManage && <button type="button" onClick={() => openMovement(item)} title="Movimentar estoque" aria-label={`Movimentar ${item.name}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate hover:bg-brand-soft hover:text-accent"><ArrowDownToLine className="h-4 w-4" /></button>}<button type="button" onClick={() => openEditIngredient(item)} title="Editar" aria-label={`Editar ${item.name}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate hover:bg-canvas hover:text-ink"><Edit3 className="h-4 w-4" /></button>{canManage && <button type="button" onClick={() => setDeleteTarget(item)} title="Remover" aria-label={`Remover ${item.name}`} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate hover:bg-bad-soft hover:text-bad"><Trash2 className="h-4 w-4" /></button>}</div></td></tr>
              })}</tbody></table></div>
            )}
          </section>

          <aside className="rounded-card border border-line bg-surface shadow-sm"><div className="flex items-center gap-3 border-b border-line p-4"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-accent"><Sparkles className="h-5 w-5" /></span><div><h3 className="font-display text-lg text-plum">Sugestão de reposição</h3><p className="text-xs text-slate">Baseada no estoque mínimo</p></div></div><div className="flex max-h-[530px] flex-col overflow-y-auto">{suggestions.map(({ item, quantity, total }) => <div key={item.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-canvas text-slate"><Package className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{item.name}</p><p className="text-xs text-slate">Sugerido: {number.format(quantity)} {item.unit}</p></div><div className="text-right"><p className="text-xs font-semibold text-ink">{money.format(total)}</p>{canManage && <button type="button" onClick={() => openMovement(item, 'entry', String(quantity))} className="mt-1 text-xs font-semibold text-accent hover:underline">Dar entrada</button>}</div></div>)}{!suggestions.length && <div className="px-6 py-12 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-good" /><p className="mt-3 font-semibold text-ink">Estoque em dia</p><p className="mt-1 text-sm text-slate">Nenhum item atingiu o mínimo.</p></div>}</div>{suggestions.length > 0 && <div className="flex items-center justify-between border-t border-line bg-canvas px-4 py-3"><span className="text-xs text-slate">Total estimado</span><strong className="text-ink">{money.format(metrics.restockCost)}</strong></div>}</aside>
        </div>
      ) : (
        <section className="overflow-hidden rounded-card border border-line bg-surface shadow-sm"><div className="flex items-center justify-between border-b border-line px-4 py-3"><div><h3 className="font-display text-xl text-plum">Livro de movimentações</h3><p className="text-xs text-slate">Histórico imutável das alterações de saldo.</p></div>{canManage && <button type="button" onClick={() => openMovement()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-plum px-3 text-sm font-semibold text-cream"><Plus className="h-4 w-4" />Registrar</button>}</div><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-canvas text-xs text-slate"><tr><th className="px-4 py-3">Data e hora</th><th className="px-3 py-3">Tipo</th><th className="px-3 py-3">Insumo</th><th className="px-3 py-3 text-right">Quantidade</th><th className="px-3 py-3 text-right">Saldo após</th><th className="px-3 py-3">Motivo</th><th className="px-4 py-3">Responsável</th></tr></thead><tbody>{movements.map((movement) => { const delta = Number(movement.delta); return <tr key={movement.id} className="border-t border-line"><td className="px-4 py-3 text-xs text-slate">{new Date(movement.createdAt).toLocaleString('pt-BR')}</td><td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${delta >= 0 ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>{delta >= 0 ? <ArrowDownToLine className="h-3 w-3" /> : <ArrowUpFromLine className="h-3 w-3" />}{movementLabels[movement.type] || movement.type}</span></td><td className="px-3 py-3"><p className="font-semibold text-ink">{movement.ingredient.name}</p><p className="font-mono text-[11px] text-slate">{movement.ingredient.sku}</p></td><td className={`px-3 py-3 text-right font-semibold ${delta >= 0 ? 'text-good' : 'text-bad'}`}>{delta > 0 ? '+' : ''}{number.format(delta)} {movement.ingredient.unit}</td><td className="px-3 py-3 text-right text-ink">{number.format(Number(movement.balanceAfter))} {movement.ingredient.unit}</td><td className="max-w-xs px-3 py-3 text-slate">{movement.reason || '—'}</td><td className="px-4 py-3 text-slate">{movement.actor ? `${movement.actor.firstName} ${movement.actor.lastName}` : 'Sistema'}</td></tr>})}</tbody></table>{!loading && movements.length === 0 && <div className="px-6 py-16 text-center"><History className="mx-auto h-8 w-8 text-slate/40" /><p className="mt-3 font-semibold text-ink">Nenhuma movimentação registrada</p><p className="mt-1 text-sm text-slate">As próximas entradas, saídas e vendas aparecerão aqui.</p></div>}</div></section>
      )}

      {showIngredientForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"><form onSubmit={saveIngredient} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-card border border-line bg-surface p-5 shadow-xl"><div className="mb-5 flex items-start justify-between"><div><h3 className="font-display text-2xl text-plum">{editingId ? 'Editar insumo' : 'Novo insumo'}</h3><p className="mt-1 text-sm text-slate">Dados de custo, unidade e controle de reposição.</p></div><button type="button" onClick={() => setShowIngredientForm(false)} aria-label="Fechar"><X className="h-5 w-5 text-slate" /></button></div><div className="grid gap-4 sm:grid-cols-2"><label className="flex flex-col gap-1.5 text-sm font-medium text-ink sm:col-span-2">Nome<input autoFocus value={ingredientForm.name} onChange={(event) => setIngredientForm((current) => ({ ...current, name: event.target.value }))} className={fieldClass} /></label><label className="flex flex-col gap-1.5 text-sm font-medium text-ink">SKU<input value={ingredientForm.sku} onChange={(event) => setIngredientForm((current) => ({ ...current, sku: event.target.value.toUpperCase() }))} className={fieldClass} /></label><label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Código de barras<input value={ingredientForm.barcode} onChange={(event) => setIngredientForm((current) => ({ ...current, barcode: event.target.value }))} placeholder="8 a 14 dígitos" className={fieldClass} /></label><label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Unidade<select value={ingredientForm.unit} onChange={(event) => setIngredientForm((current) => ({ ...current, unit: event.target.value }))} className={fieldClass}>{['un', 'kg', 'g', 'l', 'ml', 'cx', 'pct'].map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label><label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Custo unitário<input type="number" min="0" step="0.01" value={ingredientForm.price} onChange={(event) => setIngredientForm((current) => ({ ...current, price: event.target.value }))} className={fieldClass} /></label><label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Estoque mínimo<input type="number" min="0" step="0.0001" value={ingredientForm.minimumStock} onChange={(event) => setIngredientForm((current) => ({ ...current, minimumStock: event.target.value }))} className={fieldClass} /></label><label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Fator de perda (%)<input type="number" min="0" max="100" step="0.01" value={ingredientForm.breakageFactor} onChange={(event) => setIngredientForm((current) => ({ ...current, breakageFactor: event.target.value }))} className={fieldClass} /></label>{!editingId && <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Saldo inicial<input type="number" min="0" step="0.0001" value={ingredientForm.initialStock} onChange={(event) => setIngredientForm((current) => ({ ...current, initialStock: event.target.value }))} className={fieldClass} /></label>}<label className="flex flex-col gap-1.5 text-sm font-medium text-ink sm:col-span-2">Descrição<textarea rows={3} value={ingredientForm.description} onChange={(event) => setIngredientForm((current) => ({ ...current, description: event.target.value }))} className={`${fieldClass} h-auto py-3`} /></label><label className="flex items-center gap-2 text-sm font-medium text-ink"><input type="checkbox" checked={ingredientForm.active} onChange={(event) => setIngredientForm((current) => ({ ...current, active: event.target.checked }))} />Insumo ativo</label></div>{editingId && <p className="mt-4 rounded-lg bg-brand-soft px-3 py-2 text-xs text-slate">Para corrigir o saldo, use “Nova movimentação”. Assim a alteração fica registrada no histórico.</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShowIngredientForm(false)} className="h-10 rounded-lg border border-line px-4 text-sm font-semibold text-ink">Cancelar</button><button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-plum px-4 text-sm font-semibold text-cream disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Salvar insumo</button></div></form></div>}

      {showMovementForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"><form onSubmit={saveMovement} className="w-full max-w-lg rounded-card border border-line bg-surface p-5 shadow-xl"><div className="mb-5 flex items-start justify-between"><div><h3 className="font-display text-2xl text-plum">Nova movimentação</h3><p className="mt-1 text-sm text-slate">O saldo e o histórico serão atualizados juntos.</p></div><button type="button" onClick={() => setShowMovementForm(false)} aria-label="Fechar"><X className="h-5 w-5 text-slate" /></button></div><div className="flex flex-col gap-4"><label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Insumo<select value={movementForm.ingredientId} onChange={(event) => setMovementForm((current) => ({ ...current, ingredientId: event.target.value }))} className={fieldClass}><option value="">Selecione</option>{ingredients.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · saldo {number.format(Number(item.stock))} {item.unit}</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Tipo<select value={movementForm.type} onChange={(event) => setMovementForm((current) => ({ ...current, type: event.target.value }))} className={fieldClass}><option value="entry">Entrada</option><option value="exit">Saída</option><option value="loss">Perda</option></select></label><label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Quantidade<input type="number" min="0.0001" step="0.0001" value={movementForm.quantity} onChange={(event) => setMovementForm((current) => ({ ...current, quantity: event.target.value }))} className={fieldClass} /></label></div><label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Motivo<textarea rows={3} value={movementForm.reason} onChange={(event) => setMovementForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Ex.: Compra do fornecedor, avaria, contagem física" className={`${fieldClass} h-auto py-3`} /></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setShowMovementForm(false)} className="h-10 rounded-lg border border-line px-4 text-sm font-semibold text-ink">Cancelar</button><button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-plum px-4 text-sm font-semibold text-cream disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Registrar movimentação</button></div></form></div>}

      {deleteTarget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-md rounded-card border border-line bg-surface p-5 shadow-xl"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-bad-soft text-bad"><Trash2 className="h-5 w-5" /></span><h3 className="mt-4 font-display text-2xl text-plum">Remover insumo?</h3><p className="mt-2 text-sm leading-relaxed text-slate">“{deleteTarget.name}” será removido. Se estiver em uso por fichas técnicas ou notas, o DeliOne apenas o desativará para preservar o histórico.</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setDeleteTarget(null)} className="h-10 rounded-lg border border-line px-4 text-sm font-semibold text-ink">Cancelar</button><button type="button" onClick={() => void deleteIngredient()} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-lg bg-bad px-4 text-sm font-semibold text-white disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Confirmar</button></div></div></div>}
    </div>
  )
}
