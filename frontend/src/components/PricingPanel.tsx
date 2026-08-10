import { useState, useEffect, useCallback } from 'react'
import { useTenant } from '../context/TenantContext'
import { apiGet, apiPost, apiPut, errorMessage } from '../lib/api'

// ---------------------------------------------------------------------------
// TIPOS
// ---------------------------------------------------------------------------

interface SalesChannel {
  id: string
  name: string
  slug: string
  platformFeePerc: number
  platformFeeFixed: number
  paymentFeePerc: number
  targetMarginPerc: number
  manualMultiplier: number
  active: boolean
  _count?: { pricingRules: number; orders: number }
}

interface PricingRule {
  id: string
  costPrice: number
  markupPerc: number
  suggestedPrice: number
  finalPrice: number
  realMarginPerc: number
  product: { id: string; name: string; sku: string; costPrice: number }
  salesChannel: { id: string; name: string; slug: string }
}

interface FleetMember {
  id: string
  name: string
  vehicleType: string
  kmPerLiter: number
  fuelCostPerLiter: number
  deliveryFee: number
  feePerKm: number
  baseRadiusKm: number
  active: boolean
}

interface DeliveryQuote {
  distanceKm: number
  ownFleet: { fleetId: string; fleetName: string; cost: number; breakdown: Record<string, number> } | null
  appDelivery: { estimatedCost: number; basis: string }
  recommendation: 'own_fleet' | 'app_delivery' | 'no_fleet'
  estimatedSaving: number
  savingLabel: string
}

/**
 * Caminho relativo: o proxy do Vite (dev) e o servidor de producao resolvem o
 * destino. Estava `http://localhost:3001` cravado aqui, o que so funcionava no
 * navegador da propria maquina do backend — em qualquer outro dava
 * "Failed to fetch". O JWT vai pelo cliente de `lib/api`.
 */
const API = '/api/pricing'

// ---------------------------------------------------------------------------
// COMPONENTE PRINCIPAL
// ---------------------------------------------------------------------------

export default function PricingPanel() {
  const { activeTenant } = useTenant()
  const [tab, setTab] = useState<'table' | 'channels' | 'fleet' | 'dispatch'>('table')
  const [channels, setChannels]     = useState<SalesChannel[]>([])
  const [rules, setRules]           = useState<PricingRule[]>([])
  const [fleet, setFleet]           = useState<FleetMember[]>([])
  const [loading, setLoading]       = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [editPrice, setEditPrice]   = useState('')
  const [channelForm, setChannelForm] = useState<Partial<SalesChannel> | null>(null)
  const [fleetForm, setFleetForm]   = useState<Partial<FleetMember> | null>(null)
  const [quote, setQuote]           = useState<DeliveryQuote | null>(null)
  const [quoteForm, setQuoteForm]   = useState({ orderId: '', distanceKm: '' })
  const [msg, setMsg]               = useState('')

  // O header `x-tenant-id` que existia aqui foi removido: o backend nunca o le,
  // a loja ativa vem assinada dentro do JWT.
  const load = useCallback(async () => {
    if (!activeTenant) return
    setLoading(true)
    setMsg('')
    try {
      const [chData, rulesData, fleetData] = await Promise.all([
        apiGet<SalesChannel[]>(`${API}/channels`),
        apiGet<PricingRule[]>(`${API}/table`),
        apiGet<FleetMember[]>(`${API}/fleet`),
      ])
      // `Array.isArray` em vez de `?? []`: se a API mudar o formato, a tela
      // mostra vazio em vez de estourar num `for...of` sobre um objeto.
      setChannels(Array.isArray(chData) ? chData : [])
      setRules(Array.isArray(rulesData) ? rulesData : [])
      setFleet(Array.isArray(fleetData) ? fleetData : [])
    } catch (err) {
      // Antes so havia `finally`: uma falha aqui virava promise rejeitada sem
      // tratamento, que o React reporta como erro de runtime na tela.
      setMsg(errorMessage(err, 'Nao foi possivel carregar os dados de precificacao.'))
    } finally {
      setLoading(false)
    }
  }, [activeTenant])

  useEffect(() => { load() }, [load])

  // ---- Tabela de preços ----
  const saveRulePrice = async (ruleId: string) => {
    try {
      await apiPut(`${API}/rule/${ruleId}/price`, { finalPrice: parseFloat(editPrice) })
      setEditingRuleId(null)
      await load()
    } catch (err) {
      setMsg(errorMessage(err, 'Nao foi possivel salvar o preco.'))
    }
  }

  const recalcAll = async () => {
    setLoading(true)
    try {
      const d = await apiPost<{ message?: string }>(`${API}/recalculate-all`)
      setMsg(d?.message ?? 'Precos recalculados.')
      await load()
    } catch (err) {
      setMsg(errorMessage(err, 'Nao foi possivel recalcular os precos.'))
    } finally {
      // `setLoading(false)` estava fora de try/finally: se a chamada falhasse,
      // o botao ficava travado em "carregando" para sempre.
      setLoading(false)
    }
  }

  // ---- Canal ----
  const saveChannel = async () => {
    if (!channelForm) return
    const isEdit = !!channelForm.id
    try {
      const url = `${API}/channels${isEdit ? `/${channelForm.id}` : ''}`
      await (isEdit ? apiPut(url, channelForm) : apiPost(url, channelForm))
      setChannelForm(null)
      await load()
    } catch (err) {
      setMsg(errorMessage(err, 'Nao foi possivel salvar o canal de venda.'))
    }
  }

  // ---- Frota ----
  const saveFleet = async () => {
    if (!fleetForm) return
    const isEdit = !!fleetForm.id
    try {
      const url = `${API}/fleet${isEdit ? `/${fleetForm.id}` : ''}`
      await (isEdit ? apiPut(url, fleetForm) : apiPost(url, fleetForm))
      setFleetForm(null)
      await load()
    } catch (err) {
      setMsg(errorMessage(err, 'Nao foi possivel salvar o entregador.'))
    }
  }

  // ---- Cotação ----
  const getQuote = async () => {
    try {
      const d = await apiPost<DeliveryQuote>(`${API}/delivery-quote`, {
        orderId: quoteForm.orderId,
        distanceKm: parseFloat(quoteForm.distanceKm),
      })
      setQuote(d)
    } catch (err) {
      setMsg(errorMessage(err, 'Nao foi possivel calcular a cotacao.'))
    }
  }

  const confirmQuote = async (choice: 'own_fleet' | 'app_delivery') => {
    try {
      await apiPost(`${API}/delivery-quote/confirm`, { orderId: quoteForm.orderId, choice })
      setMsg(`Decisão "${choice === 'own_fleet' ? 'Frota Própria' : 'App Delivery'}" registrada.`)
      setQuote(null)
    } catch (err) {
      // Sem o catch, a decisao parecia registrada mesmo quando a API recusava:
      // a mensagem de sucesso aparecia antes de qualquer confirmacao.
      setMsg(errorMessage(err, 'Nao foi possivel registrar a decisao.'))
    }
  }

  // ---- Grupos de linhas por produto ----
  // `Map` em vez de objeto indexado: o `get` devolve um tipo honesto e some a
  // necessidade de reafirmar ao TypeScript que a chave existe.
  const productMap = new Map<string, PricingRule[]>()
  for (const r of rules) {
    const bucket = productMap.get(r.product.id)
    if (bucket) bucket.push(r)
    else productMap.set(r.product.id, [r])
  }

  const marginColor = (m: number) => {
    if (m >= 30) return '#22c55e'
    if (m >= 15) return '#f59e0b'
    return '#ef4444'
  }

  const channelDefaultForm: Partial<SalesChannel> = {
    name: '', slug: '', platformFeePerc: 0, platformFeeFixed: 0,
    paymentFeePerc: 0, targetMarginPerc: 30, manualMultiplier: 1,
  }

  const fleetDefaultForm: Partial<FleetMember> = {
    name: '', vehicleType: 'moto', kmPerLiter: 20,
    fuelCostPerLiter: 6.50, deliveryFee: 0, feePerKm: 0, baseRadiusKm: 3,
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Precificacao e Logistica</h2>
        <div style={styles.tabs}>
          {(['table', 'channels', 'fleet', 'dispatch'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
            >
              {{ table: 'Tabela de Precos', channels: 'Canais', fleet: 'Frota', dispatch: 'Despacho' }[t]}
            </button>
          ))}
        </div>
      </div>

      {msg && (
        <div style={styles.toast}>
          {msg}
          <button onClick={() => setMsg('')} style={styles.toastClose}>x</button>
        </div>
      )}

      {/* ================================================================
          TAB: TABELA DE PRECOS
      ================================================================ */}
      {tab === 'table' && (
        <div>
          <div style={styles.toolbar}>
            <span style={styles.hint}>
              Precos calculados com markup reverso por canal. Verde = margem ok, amarelo = atencao, vermelho = prejuizo.
            </span>
            <button onClick={recalcAll} disabled={loading} style={styles.btnPrimary}>
              {loading ? 'Calculando...' : 'Recalcular Tudo'}
            </button>
          </div>

          {[...productMap.values()].map(productRules => {
            const product = productRules[0]?.product
            if (!product) return null
            return (
              <div key={product.id} style={styles.productBlock}>
                <div style={styles.productHeader}>
                  <span style={styles.productName}>{product.name}</span>
                  <span style={styles.productSku}>SKU: {product.sku}</span>
                  <span style={styles.costBadge}>
                    Custo: R${Number(product.costPrice).toFixed(2)}
                  </span>
                </div>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      {['Canal', 'Markup', 'Preco Sugerido', 'Preco Final', 'Margem Real', 'Acoes'].map(h => (
                        <th key={h} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {productRules.map(rule => (
                      <tr key={rule.id} style={styles.tr}>
                        <td style={styles.td}>
                          <span style={styles.channelBadge}>{rule.salesChannel.name}</span>
                        </td>
                        <td style={styles.td}>{Number(rule.markupPerc).toFixed(1)}%</td>
                        <td style={styles.td}>R${Number(rule.suggestedPrice).toFixed(2)}</td>
                        <td style={styles.td}>
                          {editingRuleId === rule.id ? (
                            <div style={styles.inlineEdit}>
                              <input
                                type="number"
                                value={editPrice}
                                onChange={e => setEditPrice(e.target.value)}
                                style={styles.inlineInput}
                                step="0.01"
                              />
                              <button onClick={() => saveRulePrice(rule.id)} style={styles.btnSave}>ok</button>
                              <button onClick={() => setEditingRuleId(null)} style={styles.btnCancel}>x</button>
                            </div>
                          ) : (
                            <strong>R${Number(rule.finalPrice).toFixed(2)}</strong>
                          )}
                        </td>
                        <td style={styles.td}>
                          <span style={{ color: marginColor(Number(rule.realMarginPerc)), fontWeight: 700 }}>
                            {Number(rule.realMarginPerc).toFixed(1)}%
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button
                            onClick={() => { setEditingRuleId(rule.id); setEditPrice(String(rule.finalPrice)) }}
                            style={styles.btnSmall}
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}

      {/* ================================================================
          TAB: CANAIS DE VENDA
      ================================================================ */}
      {tab === 'channels' && (
        <div>
          <div style={styles.toolbar}>
            <span style={styles.hint}>Configure as taxas de cada plataforma. O markup reverso usa esses valores.</span>
            <button onClick={() => setChannelForm(channelDefaultForm)} style={styles.btnPrimary}>
              + Novo Canal
            </button>
          </div>

          {channelForm && (
            <div style={styles.formCard}>
              <h3 style={styles.formTitle}>{channelForm.id ? 'Editar Canal' : 'Novo Canal'}</h3>
              <div style={styles.formGrid}>
                {[
                  { label: 'Nome', key: 'name', type: 'text' },
                  { label: 'Slug', key: 'slug', type: 'text' },
                  { label: 'Taxa Plataforma (%)', key: 'platformFeePerc', type: 'number' },
                  { label: 'Taxa Fixa por Pedido (R$)', key: 'platformFeeFixed', type: 'number' },
                  { label: 'Taxa Pagamento (%)', key: 'paymentFeePerc', type: 'number' },
                  { label: 'Margem Alvo (%)', key: 'targetMarginPerc', type: 'number' },
                  { label: 'Multiplicador Manual', key: 'manualMultiplier', type: 'number' },
                ].map(f => (
                  <label key={f.key} style={styles.fieldLabel}>
                    {f.label}
                    <input
                      type={f.type}
                      value={(channelForm as any)[f.key] ?? ''}
                      onChange={e => setChannelForm(prev => ({
                        ...prev!, [f.key]: f.type === 'number' ? parseFloat(e.target.value) : e.target.value,
                      }))}
                      style={styles.input}
                      step="0.01"
                    />
                  </label>
                ))}
              </div>
              <div style={styles.formActions}>
                <button onClick={saveChannel} style={styles.btnPrimary}>Salvar</button>
                <button onClick={() => setChannelForm(null)} style={styles.btnSecondary}>Cancelar</button>
              </div>
            </div>
          )}

          <div style={styles.cardGrid}>
            {channels.map(ch => (
              <div key={ch.id} style={styles.channelCard}>
                <div style={styles.channelCardHeader}>
                  <span style={styles.channelName}>{ch.name}</span>
                  <span style={{ ...styles.statusDot, background: ch.active ? '#22c55e' : '#6b7280' }} />
                </div>
                <div style={styles.channelStats}>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Taxa Plataforma</span>
                    <span style={styles.statValue}>{Number(ch.platformFeePerc).toFixed(1)}%{Number(ch.platformFeeFixed) > 0 ? ` + R$${Number(ch.platformFeeFixed).toFixed(2)}` : ''}</span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Taxa Pagamento</span>
                    <span style={styles.statValue}>{Number(ch.paymentFeePerc).toFixed(1)}%</span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Margem Alvo</span>
                    <span style={styles.statValue}>{Number(ch.targetMarginPerc).toFixed(1)}%</span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Multiplicador</span>
                    <span style={styles.statValue}>{Number(ch.manualMultiplier).toFixed(4)}x</span>
                  </div>
                </div>
                <div style={styles.channelCardFooter}>
                  <span style={styles.hint}>{ch._count?.pricingRules ?? 0} produtos | {ch._count?.orders ?? 0} pedidos</span>
                  <button onClick={() => setChannelForm(ch)} style={styles.btnSmall}>Editar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================================================================
          TAB: FROTA PROPRIA
      ================================================================ */}
      {tab === 'fleet' && (
        <div>
          <div style={styles.toolbar}>
            <span style={styles.hint}>Cadastre motoboys. O comparador de rotas usara esses dados para calcular o custo real da entrega.</span>
            <button onClick={() => setFleetForm(fleetDefaultForm)} style={styles.btnPrimary}>
              + Novo Motoboy
            </button>
          </div>

          {fleetForm && (
            <div style={styles.formCard}>
              <h3 style={styles.formTitle}>{fleetForm.id ? 'Editar' : 'Novo Motoboy/Veiculo'}</h3>
              <div style={styles.formGrid}>
                {[
                  { label: 'Nome', key: 'name', type: 'text' },
                  { label: 'Tipo', key: 'vehicleType', type: 'text' },
                  { label: 'km/l (consumo)', key: 'kmPerLiter', type: 'number' },
                  { label: 'Combustivel (R$/l)', key: 'fuelCostPerLiter', type: 'number' },
                  { label: 'Taxa Fixa (R$/corrida)', key: 'deliveryFee', type: 'number' },
                  { label: 'Taxa por km extra (R$/km)', key: 'feePerKm', type: 'number' },
                  { label: 'Raio Base (km)', key: 'baseRadiusKm', type: 'number' },
                ].map(f => (
                  <label key={f.key} style={styles.fieldLabel}>
                    {f.label}
                    <input
                      type={f.type}
                      value={(fleetForm as any)[f.key] ?? ''}
                      onChange={e => setFleetForm(prev => ({
                        ...prev!, [f.key]: f.type === 'number' ? parseFloat(e.target.value) : e.target.value,
                      }))}
                      style={styles.input}
                      step="0.01"
                    />
                  </label>
                ))}
              </div>
              <div style={styles.formActions}>
                <button onClick={saveFleet} style={styles.btnPrimary}>Salvar</button>
                <button onClick={() => setFleetForm(null)} style={styles.btnSecondary}>Cancelar</button>
              </div>
            </div>
          )}

          <div style={styles.cardGrid}>
            {fleet.map(m => (
              <div key={m.id} style={styles.channelCard}>
                <div style={styles.channelCardHeader}>
                  <span style={styles.channelName}>{m.name}</span>
                  <span style={styles.hint}>{m.vehicleType}</span>
                </div>
                <div style={styles.channelStats}>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Consumo</span>
                    <span style={styles.statValue}>{Number(m.kmPerLiter).toFixed(1)} km/l</span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Combustivel</span>
                    <span style={styles.statValue}>R${Number(m.fuelCostPerLiter).toFixed(2)}/l</span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Taxa Fixa</span>
                    <span style={styles.statValue}>R${Number(m.deliveryFee).toFixed(2)}</span>
                  </div>
                  <div style={styles.stat}>
                    <span style={styles.statLabel}>Raio Base</span>
                    <span style={styles.statValue}>{Number(m.baseRadiusKm).toFixed(1)} km</span>
                  </div>
                </div>
                <div style={styles.channelCardFooter}>
                  <button onClick={() => setFleetForm(m)} style={styles.btnSmall}>Editar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================================================================
          TAB: DESPACHO / COMPARADOR DE ROTAS
      ================================================================ */}
      {tab === 'dispatch' && (
        <div>
          <div style={styles.formCard}>
            <h3 style={styles.formTitle}>Comparador de Rotas</h3>
            <div style={styles.formGrid}>
              <label style={styles.fieldLabel}>
                ID do Pedido
                <input
                  type="text"
                  value={quoteForm.orderId}
                  onChange={e => setQuoteForm(p => ({ ...p, orderId: e.target.value }))}
                  style={styles.input}
                  placeholder="order_xxx"
                />
              </label>
              <label style={styles.fieldLabel}>
                Distancia em km
                <input
                  type="number"
                  value={quoteForm.distanceKm}
                  onChange={e => setQuoteForm(p => ({ ...p, distanceKm: e.target.value }))}
                  style={styles.input}
                  step="0.1"
                  placeholder="ex: 3.5"
                />
              </label>
            </div>
            <div style={styles.formActions}>
              <button onClick={getQuote} style={styles.btnPrimary}>Calcular Rota</button>
            </div>
          </div>

          {quote && (
            <div style={styles.quoteCard}>
              <h3 style={styles.formTitle}>Resultado da Cotacao — {quote.distanceKm} km</h3>

              <div style={styles.quoteGrid}>
                {/* Frota propria */}
                <div style={{
                  ...styles.quoteOption,
                  ...(quote.recommendation === 'own_fleet' ? styles.quoteRecommended : {})
                }}>
                  <div style={styles.quoteOptionHeader}>
                    <span style={styles.quoteOptionTitle}>Frota Propria</span>
                    {quote.recommendation === 'own_fleet' && (
                      <span style={styles.recBadge}>RECOMENDADO</span>
                    )}
                  </div>
                  {quote.ownFleet ? (
                    <>
                      <div style={styles.quoteCost}>R${quote.ownFleet.cost.toFixed(2)}</div>
                      <div style={styles.quoteDetail}>Motoboy: {quote.ownFleet.fleetName}</div>
                      <div style={styles.breakdownGrid}>
                        <span>Combustivel</span><span>R${quote.ownFleet.breakdown.fuelCost?.toFixed(2)}</span>
                        <span>Taxa Fixa</span><span>R${quote.ownFleet.breakdown.driverFee?.toFixed(2)}</span>
                        <span>km Extra</span><span>R${quote.ownFleet.breakdown.extraKmFee?.toFixed(2)}</span>
                      </div>
                      <button
                        onClick={() => confirmQuote('own_fleet')}
                        style={styles.btnChoose}
                      >
                        Despachar Frota Propria
                      </button>
                    </>
                  ) : (
                    <div style={styles.hint}>Nenhuma frota cadastrada</div>
                  )}
                </div>

                {/* App delivery */}
                <div style={{
                  ...styles.quoteOption,
                  ...(quote.recommendation === 'app_delivery' ? styles.quoteRecommended : {})
                }}>
                  <div style={styles.quoteOptionHeader}>
                    <span style={styles.quoteOptionTitle}>App Delivery</span>
                    {quote.recommendation === 'app_delivery' && (
                      <span style={styles.recBadge}>RECOMENDADO</span>
                    )}
                  </div>
                  <div style={styles.quoteCost}>R${quote.appDelivery.estimatedCost.toFixed(2)}</div>
                  <div style={styles.quoteDetail}>{quote.appDelivery.basis}</div>
                  <button
                    onClick={() => confirmQuote('app_delivery')}
                    style={styles.btnChoose}
                  >
                    Despachar via App
                  </button>
                </div>
              </div>

              <div style={styles.savingBanner}>
                {quote.savingLabel}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ESTILOS (sem CSS refinado — foco em estrutura/lógica)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container:       { padding: 16, fontFamily: 'monospace', maxWidth: 1200 },
  header:          { marginBottom: 16 },
  title:           { fontSize: 20, fontWeight: 700, marginBottom: 12 },
  tabs:            { display: 'flex', gap: 8 },
  tab:             { padding: '6px 14px', cursor: 'pointer', border: '1px solid #374151', background: 'transparent', color: '#d1d5db', borderRadius: 4 },
  tabActive:       { background: '#1d4ed8', borderColor: '#1d4ed8', color: '#fff' },
  toolbar:         { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  hint:            { fontSize: 12, color: '#9ca3af' },
  btnPrimary:      { padding: '7px 16px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' },
  btnSecondary:    { padding: '7px 16px', background: '#374151', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' },
  btnSmall:        { padding: '3px 10px', background: '#374151', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  btnSave:         { padding: '2px 8px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', marginLeft: 4 },
  btnCancel:       { padding: '2px 8px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', marginLeft: 2 },
  toast:           { background: '#1d4ed8', color: '#fff', padding: '8px 12px', borderRadius: 4, marginBottom: 12, display: 'flex', justifyContent: 'space-between' },
  toastClose:      { background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' },
  productBlock:    { marginBottom: 20, border: '1px solid #374151', borderRadius: 6 },
  productHeader:   { display: 'flex', gap: 12, padding: '10px 14px', background: '#1f2937', borderRadius: '6px 6px 0 0', alignItems: 'center' },
  productName:     { fontWeight: 700, fontSize: 14 },
  productSku:      { fontSize: 12, color: '#9ca3af' },
  costBadge:       { fontSize: 12, background: '#374151', padding: '2px 8px', borderRadius: 4 },
  table:           { width: '100%', borderCollapse: 'collapse' },
  th:              { padding: '8px 12px', textAlign: 'left', fontSize: 12, color: '#9ca3af', borderBottom: '1px solid #374151' },
  tr:              { borderBottom: '1px solid #1f2937' },
  td:              { padding: '8px 12px', fontSize: 13 },
  channelBadge:    { background: '#1e3a5f', color: '#93c5fd', padding: '2px 8px', borderRadius: 4, fontSize: 12 },
  inlineEdit:      { display: 'flex', alignItems: 'center' },
  inlineInput:     { width: 80, padding: '2px 6px', background: '#111827', border: '1px solid #4b5563', color: '#fff', borderRadius: 4 },
  formCard:        { background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: 16, marginBottom: 16 },
  formTitle:       { fontWeight: 700, marginBottom: 12 },
  formGrid:        { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 },
  formActions:     { display: 'flex', gap: 8, marginTop: 12 },
  fieldLabel:      { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#9ca3af' },
  input:           { padding: '6px 10px', background: '#111827', border: '1px solid #4b5563', color: '#fff', borderRadius: 4, fontSize: 13 },
  cardGrid:        { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 },
  channelCard:     { background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: 14 },
  channelCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  channelName:     { fontWeight: 700 },
  statusDot:       { width: 8, height: 8, borderRadius: '50%' },
  channelStats:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 },
  stat:            { display: 'flex', flexDirection: 'column', gap: 2 },
  statLabel:       { fontSize: 11, color: '#9ca3af' },
  statValue:       { fontSize: 13, fontWeight: 600 },
  channelCardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  quoteCard:       { background: '#1f2937', border: '1px solid #374151', borderRadius: 6, padding: 16 },
  quoteGrid:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 },
  quoteOption:     { background: '#111827', border: '1px solid #374151', borderRadius: 6, padding: 14 },
  quoteRecommended: { border: '2px solid #16a34a' },
  quoteOptionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  quoteOptionTitle: { fontWeight: 700 },
  recBadge:        { background: '#16a34a', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 4 },
  quoteCost:       { fontSize: 28, fontWeight: 700, marginBottom: 6 },
  quoteDetail:     { fontSize: 12, color: '#9ca3af', marginBottom: 10 },
  breakdownGrid:   { display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 16px', fontSize: 12, marginBottom: 12, color: '#d1d5db' },
  btnChoose:       { width: '100%', padding: '8px 0', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 },
  savingBanner:    { textAlign: 'center', padding: '10px', background: '#14532d', borderRadius: 4, fontWeight: 700, color: '#86efac' },
}
