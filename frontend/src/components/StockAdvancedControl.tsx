import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardCheck, Loader2, PackagePlus, Plus, Trash2, X } from 'lucide-react'

import { apiGet, apiPost, errorMessage } from '../lib/api'

interface Ingredient { id: string; name: string; sku: string; unit: string; stock: number | string; active: boolean }
interface StockLot { id: string; code: string; quantity: number | string; expiresAt?: string | null; receivedAt: string; notes?: string | null; ingredient: Pick<Ingredient, 'id' | 'name' | 'sku' | 'unit'> }
interface Inventory { id: string; reference: string; notes?: string | null; itemCount: number; differenceCount: number; createdAt: string; items: Array<{ id: string; expectedQty: number | string; countedQty: number | string; difference: number | string; ingredient: Pick<Ingredient, 'id' | 'name' | 'sku' | 'unit'> }> }

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 })
const fieldClass = 'h-11 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink outline-none focus:border-brand'

function lotState(lot: StockLot) {
  if (!lot.expiresAt) return { label: 'Sem validade', tone: 'bg-slate/10 text-slate', days: null }
  const days = Math.ceil((new Date(lot.expiresAt).getTime() - Date.now()) / 86400000)
  if (days < 0) return { label: 'Vencido', tone: 'bg-bad-soft text-bad', days }
  if (days <= 7) return { label: `Vence em ${days}d`, tone: 'bg-bad-soft text-bad', days }
  if (days <= 30) return { label: `Vence em ${days}d`, tone: 'bg-warn-soft text-warn', days }
  return { label: 'Dentro da validade', tone: 'bg-good-soft text-good', days }
}

export function StockAdvancedControl({ mode, ingredients, canManage, onChanged }: { mode: 'lots' | 'inventory'; ingredients: Ingredient[]; canManage: boolean; onChanged: () => Promise<void> }) {
  const [lots, setLots] = useState<StockLot[]>([])
  const [inventories, setInventories] = useState<Inventory[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showLot, setShowLot] = useState(false)
  const [showInventory, setShowInventory] = useState(false)
  const [discard, setDiscard] = useState<StockLot | null>(null)
  const [lotForm, setLotForm] = useState({ ingredientId: '', code: '', quantity: '', expiresAt: '', unitCost: '', notes: '' })
  const [inventoryNotes, setInventoryNotes] = useState('')
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [discardForm, setDiscardForm] = useState({ quantity: '', reason: 'Produto vencido ou impróprio para uso' })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      if (mode === 'lots') setLots(await apiGet<StockLot[]>('/api/ingredients/lots'))
      else setInventories(await apiGet<Inventory[]>('/api/ingredients/inventories'))
    } catch (err) { setError(errorMessage(err, 'Não foi possível carregar os dados.')) }
    finally { setLoading(false) }
  }, [mode])

  useEffect(() => { void load() }, [load])

  const lotMetrics = useMemo(() => ({
    active: lots.filter(lot => Number(lot.quantity) > 0).length,
    expiring: lots.filter(lot => { const state = lotState(lot); return state.days != null && state.days >= 0 && state.days <= 30 && Number(lot.quantity) > 0 }).length,
    expired: lots.filter(lot => (lotState(lot).days ?? 0) < 0 && Number(lot.quantity) > 0).length,
  }), [lots])

  function openLot() {
    const ingredient = ingredients.find(item => item.active)
    setLotForm({ ingredientId: ingredient?.id || '', code: '', quantity: '', expiresAt: '', unitCost: '', notes: '' })
    setShowLot(true); setNotice('')
  }

  function openInventory() {
    setCounts(Object.fromEntries(ingredients.filter(item => item.active).map(item => [item.id, String(item.stock)])))
    setInventoryNotes(''); setShowInventory(true); setNotice('')
  }

  async function saveLot(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      await apiPost('/api/ingredients/lots', { ...lotForm, quantity: Number(lotForm.quantity), unitCost: lotForm.unitCost ? Number(lotForm.unitCost) : null, expiresAt: lotForm.expiresAt || null, notes: lotForm.notes || null })
      setShowLot(false); setNotice('Lote registrado e saldo atualizado.'); await Promise.all([load(), onChanged()])
    } catch (err) { setError(errorMessage(err, 'Não foi possível registrar o lote.')) }
    finally { setSaving(false) }
  }

  async function saveInventory(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const items = ingredients.filter(item => item.active).map(item => ({ ingredientId: item.id, countedQty: Number(counts[item.id] || 0) }))
      await apiPost('/api/ingredients/inventories', { notes: inventoryNotes || null, items })
      setShowInventory(false); setNotice('Inventário concluído. As diferenças foram ajustadas e auditadas.'); await Promise.all([load(), onChanged()])
    } catch (err) { setError(errorMessage(err, 'Não foi possível concluir o inventário.')) }
    finally { setSaving(false) }
  }

  async function discardLot(event: FormEvent) {
    event.preventDefault(); if (!discard) return; setSaving(true); setError('')
    try {
      await apiPost(`/api/ingredients/lots/${discard.id}/discard`, { quantity: Number(discardForm.quantity), reason: discardForm.reason })
      setDiscard(null); setNotice('Baixa do lote registrada como perda.'); await Promise.all([load(), onChanged()])
    } catch (err) { setError(errorMessage(err, 'Não foi possível dar baixa no lote.')) }
    finally { setSaving(false) }
  }

  return <div className="flex flex-col gap-4">
    {error && <div role="alert" className="flex items-center justify-between rounded-lg border border-bad/25 bg-bad-soft px-4 py-3 text-sm text-bad"><span>{error}</span><button onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}
    {notice && <div role="status" className="flex items-center gap-2 rounded-lg border border-good/25 bg-good-soft px-4 py-3 text-sm text-good"><CheckCircle2 className="h-4 w-4" />{notice}</div>}

    {mode === 'lots' ? <>
      <section className="grid gap-3 sm:grid-cols-3">
        <Metric icon={CalendarDays} label="Lotes com saldo" value={lotMetrics.active} tone="brand" />
        <Metric icon={AlertTriangle} label="Vencem em 30 dias" value={lotMetrics.expiring} tone="warn" />
        <Metric icon={Trash2} label="Lotes vencidos" value={lotMetrics.expired} tone="bad" />
      </section>
      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-line p-4"><div><h3 className="font-display text-xl text-plum">Lotes e validades</h3><p className="text-xs text-slate">Entradas rastreáveis e alerta de vencimento.</p></div>{canManage && <button onClick={openLot} className="inline-flex h-10 items-center gap-2 rounded-lg bg-plum px-4 text-sm font-semibold text-cream"><PackagePlus className="h-4 w-4" />Registrar lote</button>}</div>
        {loading ? <Loading /> : lots.length === 0 ? <Empty icon={CalendarDays} title="Nenhum lote registrado" text="Registre a próxima entrada com número de lote e validade." /> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-canvas text-xs text-slate"><tr><th className="px-4 py-3">Insumo</th><th className="px-3 py-3">Lote</th><th className="px-3 py-3 text-right">Saldo</th><th className="px-3 py-3">Validade</th><th className="px-3 py-3">Situação</th><th className="px-4 py-3 text-right">Ação</th></tr></thead><tbody>{lots.map(lot => { const state = lotState(lot); return <tr key={lot.id} className="border-t border-line"><td className="px-4 py-3"><strong className="text-ink">{lot.ingredient.name}</strong><p className="font-mono text-[11px] text-slate">{lot.ingredient.sku}</p></td><td className="px-3 py-3 font-mono text-xs text-ink">{lot.code}</td><td className="px-3 py-3 text-right font-semibold">{number.format(Number(lot.quantity))} {lot.ingredient.unit}</td><td className="px-3 py-3 text-slate">{lot.expiresAt ? new Date(lot.expiresAt).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'Não informada'}</td><td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${state.tone}`}>{state.label}</span></td><td className="px-4 py-3 text-right">{canManage && Number(lot.quantity) > 0 && <button onClick={() => { setDiscard(lot); setDiscardForm({ quantity: String(lot.quantity), reason: state.days != null && state.days < 0 ? 'Descarte de lote vencido' : 'Produto impróprio para uso' }) }} className="text-xs font-semibold text-bad hover:underline">Dar baixa</button>}</td></tr> })}</tbody></table></div>}
      </section>
    </> : <section className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-line p-4"><div><h3 className="font-display text-xl text-plum">Inventário físico</h3><p className="text-xs text-slate">Conte o estoque real e ajuste divergências com histórico.</p></div>{canManage && <button onClick={openInventory} className="inline-flex h-10 items-center gap-2 rounded-lg bg-plum px-4 text-sm font-semibold text-cream"><Plus className="h-4 w-4" />Nova contagem</button>}</div>
      {loading ? <Loading /> : inventories.length === 0 ? <Empty icon={ClipboardCheck} title="Nenhum inventário concluído" text="Inicie uma contagem física para conferir todos os saldos." /> : <div className="divide-y divide-line">{inventories.map(inv => <article key={inv.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-ink">{inv.reference}</strong><p className="text-xs text-slate">{new Date(inv.createdAt).toLocaleString('pt-BR')} · {inv.itemCount} itens</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${inv.differenceCount ? 'bg-warn-soft text-warn' : 'bg-good-soft text-good'}`}>{inv.differenceCount ? `${inv.differenceCount} divergência(s)` : 'Sem divergências'}</span></div>{inv.notes && <p className="mt-2 text-sm text-slate">{inv.notes}</p>}<div className="mt-3 flex flex-wrap gap-2">{inv.items.filter(item => Number(item.difference) !== 0).slice(0, 5).map(item => <span key={item.id} className="rounded-lg bg-canvas px-2.5 py-1 text-xs text-slate">{item.ingredient.name}: {Number(item.difference) > 0 ? '+' : ''}{number.format(Number(item.difference))} {item.ingredient.unit}</span>)}</div></article>)}</div>}
    </section>}

    {showLot && <Modal title="Registrar lote" subtitle="A quantidade entra no estoque e fica rastreável pela validade." onClose={() => setShowLot(false)}><form onSubmit={saveLot} className="grid gap-4 sm:grid-cols-2"><Field label="Insumo" wide><select required value={lotForm.ingredientId} onChange={e => setLotForm(v => ({ ...v, ingredientId: e.target.value }))} className={fieldClass}>{ingredients.filter(i => i.active).map(i => <option key={i.id} value={i.id}>{i.name} · {i.unit}</option>)}</select></Field><Field label="Número do lote"><input required value={lotForm.code} onChange={e => setLotForm(v => ({ ...v, code: e.target.value }))} className={fieldClass} /></Field><Field label="Quantidade"><input required type="number" min="0.0001" step="0.0001" value={lotForm.quantity} onChange={e => setLotForm(v => ({ ...v, quantity: e.target.value }))} className={fieldClass} /></Field><Field label="Validade (opcional)"><input type="date" value={lotForm.expiresAt} onChange={e => setLotForm(v => ({ ...v, expiresAt: e.target.value }))} className={fieldClass} /></Field><Field label="Custo unitário (opcional)"><input type="number" min="0" step="0.0001" value={lotForm.unitCost} onChange={e => setLotForm(v => ({ ...v, unitCost: e.target.value }))} className={fieldClass} /></Field><Field label="Observações" wide><textarea rows={2} value={lotForm.notes} onChange={e => setLotForm(v => ({ ...v, notes: e.target.value }))} className={`${fieldClass} h-auto py-3`} /></Field><Actions saving={saving} onClose={() => setShowLot(false)} label="Registrar entrada" /></form></Modal>}

    {showInventory && <Modal title="Nova contagem física" subtitle="Informe quanto existe de verdade. Só divergências geram ajuste." onClose={() => setShowInventory(false)} wide><form onSubmit={saveInventory}><div className="max-h-[52vh] overflow-y-auto rounded-lg border border-line"><table className="w-full text-sm"><thead className="sticky top-0 bg-canvas text-xs text-slate"><tr><th className="px-3 py-2 text-left">Insumo</th><th className="px-3 py-2 text-right">Sistema</th><th className="px-3 py-2 text-right">Contagem real</th></tr></thead><tbody>{ingredients.filter(i => i.active).map(i => <tr key={i.id} className="border-t border-line"><td className="px-3 py-2"><strong>{i.name}</strong><p className="text-xs text-slate">{i.sku}</p></td><td className="px-3 py-2 text-right text-slate">{number.format(Number(i.stock))} {i.unit}</td><td className="px-3 py-2"><input required aria-label={`Contagem de ${i.name}`} type="number" min="0" step="0.0001" value={counts[i.id] ?? ''} onChange={e => setCounts(v => ({ ...v, [i.id]: e.target.value }))} className="ml-auto h-9 w-36 rounded-lg border border-line bg-canvas px-2 text-right outline-none focus:border-brand" /></td></tr>)}</tbody></table></div><Field label="Observações"><textarea rows={2} value={inventoryNotes} onChange={e => setInventoryNotes(e.target.value)} className={`${fieldClass} mt-4 h-auto py-3`} /></Field><Actions saving={saving} onClose={() => setShowInventory(false)} label="Concluir inventário" /></form></Modal>}

    {discard && <Modal title={`Baixa do lote ${discard.code}`} subtitle={`${discard.ingredient.name} · disponível ${number.format(Number(discard.quantity))} ${discard.ingredient.unit}`} onClose={() => setDiscard(null)}><form onSubmit={discardLot} className="grid gap-4"><Field label="Quantidade"><input required type="number" min="0.0001" max={Number(discard.quantity)} step="0.0001" value={discardForm.quantity} onChange={e => setDiscardForm(v => ({ ...v, quantity: e.target.value }))} className={fieldClass} /></Field><Field label="Motivo"><textarea required rows={3} value={discardForm.reason} onChange={e => setDiscardForm(v => ({ ...v, reason: e.target.value }))} className={`${fieldClass} h-auto py-3`} /></Field><Actions saving={saving} onClose={() => setDiscard(null)} label="Confirmar baixa" danger /></form></Modal>}
  </div>
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof CalendarDays; label: string; value: number; tone: 'brand' | 'warn' | 'bad' }) { const style = { brand: 'bg-brand-soft text-accent', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad' }[tone]; return <article className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-sm"><span className={`grid h-11 w-11 place-items-center rounded-full ${style}`}><Icon className="h-5 w-5" /></span><div><p className="text-xs text-slate">{label}</p><strong className="text-2xl text-plum">{value}</strong></div></article> }
function Loading() { return <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div> }
function Empty({ icon: Icon, title, text }: { icon: typeof CalendarDays; title: string; text: string }) { return <div className="px-6 py-16 text-center"><Icon className="mx-auto h-9 w-9 text-slate/35" /><p className="mt-3 font-semibold text-ink">{title}</p><p className="mt-1 text-sm text-slate">{text}</p></div> }
function Modal({ title, subtitle, onClose, wide, children }: { title: string; subtitle: string; onClose: () => void; wide?: boolean; children: ReactNode }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"><div role="dialog" aria-modal="true" className={`max-h-[92vh] w-full overflow-y-auto rounded-card border border-line bg-surface p-5 shadow-xl ${wide ? 'max-w-3xl' : 'max-w-xl'}`}><div className="mb-5 flex items-start justify-between"><div><h3 className="font-display text-2xl text-plum">{title}</h3><p className="mt-1 text-sm text-slate">{subtitle}</p></div><button type="button" onClick={onClose}><X className="h-5 w-5 text-slate" /></button></div>{children}</div></div> }
function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) { return <label className={`flex flex-col gap-1.5 text-sm font-medium text-ink ${wide ? 'sm:col-span-2' : ''}`}>{label}{children}</label> }
function Actions({ saving, onClose, label, danger }: { saving: boolean; onClose: () => void; label: string; danger?: boolean }) { return <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={onClose} className="h-10 rounded-lg border border-line px-4 text-sm font-semibold">Cancelar</button><button disabled={saving} className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-60 ${danger ? 'bg-bad' : 'bg-plum'}`}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{label}</button></div> }
