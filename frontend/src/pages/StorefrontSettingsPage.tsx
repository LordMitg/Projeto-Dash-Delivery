import { useEffect, useState } from 'react'
import { ArrowLeft, ExternalLink, Loader2, Palette, Save, Smartphone } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ImageUploadField } from '../components/ImageUploadField'
import { apiGet, apiPut, errorMessage } from '../lib/api'

interface StorefrontTheme {
  primaryColor: string
  accentColor: string
  backgroundColor: string
  textColor: string
  tagline: string
  bannerTitle: string
  bannerSubtitle: string
  bannerImageUrl: string
}

interface StoreSettings {
  name: string
  slug: string
  logoData?: string | null
  storefrontTheme?: Partial<StorefrontTheme> | null
  couponsEnabled: boolean
  loyaltyPointsEnabled: boolean
  cashbackEnabled: boolean
  pointsPerReal: number | string
  pointRedemptionValue: number | string
  cashbackPercent: number | string
}

const defaults: StorefrontTheme = {
  primaryColor: '#4A103A',
  accentColor: '#D9A629',
  backgroundColor: '#FFF8EE',
  textColor: '#251522',
  tagline: 'Feito com carinho, entregue quentinho.',
  bannerTitle: 'Seu pedido favorito está aqui',
  bannerSubtitle: 'Escolha, personalize e peça em poucos minutos.',
  bannerImageUrl: '',
}

const fields: Array<{ key: keyof StorefrontTheme; label: string }> = [
  { key: 'primaryColor', label: 'Cor principal' },
  { key: 'accentColor', label: 'Cor de destaque' },
  { key: 'backgroundColor', label: 'Cor do fundo' },
  { key: 'textColor', label: 'Cor dos textos' },
]

export default function StorefrontSettingsPage() {
  const navigate = useNavigate()
  const [store, setStore] = useState<StoreSettings | null>(null)
  const [theme, setTheme] = useState(defaults)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [loyalty,setLoyalty]=useState({couponsEnabled:false,loyaltyPointsEnabled:false,cashbackEnabled:false,pointsPerReal:1,pointRedemptionValue:0.01,cashbackPercent:2})

  useEffect(() => {
    apiGet<StoreSettings>('/api/store/settings')
      .then((data) => {
        setStore(data)
        setTheme({ ...defaults, ...(data.storefrontTheme ?? {}) })
        setLoyalty({couponsEnabled:data.couponsEnabled,loyaltyPointsEnabled:data.loyaltyPointsEnabled,cashbackEnabled:data.cashbackEnabled,pointsPerReal:Number(data.pointsPerReal),pointRedemptionValue:Number(data.pointRedemptionValue),cashbackPercent:Number(data.cashbackPercent)})
      })
      .catch((err) => setError(errorMessage(err, 'Não foi possível abrir a loja digital.')))
      .finally(() => setLoading(false))
  }, [])

  function update<K extends keyof StorefrontTheme>(key: K, value: StorefrontTheme[K]) {
    setSaved(false)
    setTheme((current) => ({ ...current, [key]: value }))
  }

  async function saveLoyalty(){setSaving(true);setError('');try{await apiPut('/api/store/loyalty',loyalty);setSaved(true)}catch(err){setError(errorMessage(err,'Não foi possível salvar o programa de relacionamento.'))}finally{setSaving(false)}}

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await apiPut('/api/store/storefront', theme)
      setSaved(true)
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar a aparência.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center gap-2 py-20 text-sm text-slate"><Loader2 className="h-5 w-5 animate-spin" /> Carregando sua vitrine...</div>

  return (
    <div className="mx-auto w-full max-w-[1320px] space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <button type="button" onClick={() => navigate('/cardapio')} className="mb-3 !p-0 text-sm text-slate hover:text-plum">
            <ArrowLeft className="h-4 w-4" /> Voltar ao cardápio
          </button>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">Canal próprio</p>
          <h2 className="font-display text-3xl text-plum">Loja digital</h2>
          <p className="mt-1 text-sm text-slate">Defina a identidade que o cliente verá ao fazer o pedido.</p>
        </div>
        {store && (
          <a href={`/loja/${store.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink shadow-sm">
            Visualizar loja <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </header>

      {error && <div role="alert" className="rounded-xl border border-bad/25 bg-bad-soft px-4 py-3 text-sm text-bad">{error}</div>}

      <form onSubmit={save} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <section className="space-y-6 rounded-card border border-line bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center gap-3 border-b border-line pb-4">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-soft text-accent"><Palette className="h-5 w-5" /></span>
            <div><h3 className="font-semibold text-ink">Cores e conteúdo</h3><p className="text-xs text-slate">Aplique a marca do negócio sem alterar o layout.</p></div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <label key={field.key} className="rounded-xl border border-line p-3">
                <span className="mb-2 block text-sm font-semibold">{field.label}</span>
                <span className="flex items-center gap-3">
                  <input type="color" value={theme[field.key]} onChange={(e) => update(field.key, e.target.value)} className="h-10 w-12 cursor-pointer !p-1" />
                  <input value={theme[field.key]} onChange={(e) => update(field.key, e.target.value.toUpperCase())} maxLength={7} className="font-mono uppercase" />
                </span>
              </label>
            ))}
          </div>

          <div className="grid gap-4">
            <label><span>Frase curta da loja</span><input value={theme.tagline} onChange={(e) => update('tagline', e.target.value)} maxLength={100} placeholder="Feito com carinho..." /></label>
            <label><span>Título do banner</span><input value={theme.bannerTitle} onChange={(e) => update('bannerTitle', e.target.value)} maxLength={90} /></label>
            <label><span>Texto do banner</span><textarea value={theme.bannerSubtitle} onChange={(e) => update('bannerSubtitle', e.target.value)} maxLength={180} rows={3} /></label>
          </div>

          <ImageUploadField value={theme.bannerImageUrl} onChange={(value) => update('bannerImageUrl', value)} label="Imagem do banner principal" />

          <div className="border-t border-line pt-5"><h3 className="font-semibold text-ink">Fidelidade e promoções</h3><p className="mt-1 text-sm text-slate">Recursos opcionais. Ative somente o que fizer sentido para esta loja.</p><div className="mt-4 grid gap-3 sm:grid-cols-3">{([['couponsEnabled','Cupons'],['loyaltyPointsEnabled','Pontos'],['cashbackEnabled','Cashback']] as const).map(([key,label])=><label key={key} className="flex cursor-pointer items-center justify-between rounded-xl border border-line p-3"><span className="font-semibold">{label}</span><input type="checkbox" checked={loyalty[key]} onChange={e=>setLoyalty(v=>({...v,[key]:e.target.checked}))} className="h-5 w-5"/></label>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-3">{loyalty.loyaltyPointsEnabled&&<><label><span>Pontos por R$ 1</span><input type="number" min="0" step="0.1" value={loyalty.pointsPerReal} onChange={e=>setLoyalty(v=>({...v,pointsPerReal:Number(e.target.value)}))}/></label><label><span>Valor de cada ponto</span><input type="number" min="0.0001" step="0.0001" value={loyalty.pointRedemptionValue} onChange={e=>setLoyalty(v=>({...v,pointRedemptionValue:Number(e.target.value)}))}/></label></>}{loyalty.cashbackEnabled&&<label><span>Cashback (%)</span><input type="number" min="0" max="100" step="0.1" value={loyalty.cashbackPercent} onChange={e=>setLoyalty(v=>({...v,cashbackPercent:Number(e.target.value)}))}/></label>}</div><button type="button" onClick={()=>void saveLoyalty()} disabled={saving} className="mt-4 h-10 rounded-lg border border-brand px-4 text-sm font-semibold text-accent">Salvar programa</button></div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <button type="submit" disabled={saving} className="inline-flex h-11 items-center gap-2 rounded-lg bg-plum px-5 font-semibold text-cream">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar aparência
            </button>
            {saved && <span className="text-sm font-medium text-good">Alterações publicadas.</span>}
          </div>
        </section>

        <aside className="xl:sticky xl:top-5 xl:self-start">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate"><Smartphone className="h-4 w-4" /> Prévia no celular</div>
          <div className="mx-auto max-w-[390px] overflow-hidden rounded-[34px] border-[7px] border-[#261920] bg-white shadow-2xl" style={{ backgroundColor: theme.backgroundColor, color: theme.textColor }}>
            <div className="p-5">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white shadow-sm">
                  {store?.logoData ? <img src={store.logoData} alt="" className="h-full w-full object-cover" /> : <span className="font-display text-xl" style={{ color: theme.primaryColor }}>{store?.name?.[0] ?? 'D'}</span>}
                </div>
                <div className="min-w-0"><p className="truncate font-bold" style={{ color: theme.primaryColor }}>{store?.name}</p><p className="truncate text-xs opacity-70">{theme.tagline}</p></div>
              </div>
              <div className="mt-4 h-10 rounded-full bg-white/90 px-4 py-2 text-sm opacity-70 shadow-sm">Buscar no cardápio...</div>
              <div className="relative mt-4 h-48 overflow-hidden rounded-3xl p-5 text-white" style={{ background: `linear-gradient(135deg, ${theme.primaryColor}, ${theme.primaryColor}cc)` }}>
                {theme.bannerImageUrl && <img src={theme.bannerImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" />}
                <div className="relative z-10 flex h-full max-w-[75%] flex-col justify-end"><h4 className="text-2xl font-extrabold">{theme.bannerTitle}</h4><p className="mt-1 text-xs text-white/85">{theme.bannerSubtitle}</p><span className="mt-3 w-fit rounded-full px-4 py-2 text-xs font-bold" style={{ backgroundColor: theme.accentColor, color: theme.primaryColor }}>Pedir agora</span></div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2">{['Destaques', 'Combos', 'Bebidas'].map((name) => <div key={name} className="text-center"><div className="mx-auto h-12 w-12 rounded-full bg-white shadow-sm" /><p className="mt-1 text-[10px] font-semibold">{name}</p></div>)}</div>
            </div>
          </div>
        </aside>
      </form>
    </div>
  )
}
