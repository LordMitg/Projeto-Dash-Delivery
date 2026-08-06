import { Suspense, lazy, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import {
  BarChart3,
  Calculator,
  ChefHat,
  FileText,
  LayoutDashboard,
  Loader2,
  LogOut,
  MapPin,
  Menu,
  Package,
  Printer,
  Receipt,
  ScanLine,
  ShoppingCart,
  Tags,
  X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { LoginPage } from './LoginPage'
import { StoreStatusBadge } from '../components/StoreStatusBadge'

// Carregamento tardio: quem opera o PDV nao precisa baixar os graficos, e o
// gerente que abre o DRE nao precisa baixar o leitor de codigo de barras.
const DashboardCharts = lazy(() =>
  import('../components/DashboardCharts').then((m) => ({ default: m.DashboardCharts })),
)
const DashboardKPIs = lazy(() =>
  import('../components/DashboardKPIs').then((m) => ({ default: m.DashboardKPIs })),
)
const ImpactSimulator = lazy(() =>
  import('../components/ImpactSimulator').then((m) => ({ default: m.ImpactSimulator })),
)
const IngredientsManagement = lazy(() =>
  import('../components/IngredientsManagement').then((m) => ({
    default: m.IngredientsManagement,
  })),
)
const PDV = lazy(() => import('../components/PDV').then((m) => ({ default: m.PDV })))
const KitchenDisplay = lazy(() =>
  import('../components/KitchenDisplay').then((m) => ({ default: m.KitchenDisplay })),
)
const BarcodeScanner = lazy(() =>
  import('../components/BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })),
)
const PrinterSettings = lazy(() =>
  import('../components/PrinterSettings').then((m) => ({ default: m.PrinterSettings })),
)
const DeliveryZones = lazy(() =>
  import('../components/DeliveryZones').then((m) => ({ default: m.DeliveryZones })),
)
const PricingPanel = lazy(() => import('../components/PricingPanel'))
const TechnicalSheet = lazy(() => import('../components/TechnicalSheet'))
const InvoiceImporter = lazy(() => import('../components/InvoiceImporter'))

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  /** Visivel apenas para quem pode ver dinheiro (admin e gerente). */
  financial?: boolean
}

/** Operacao primeiro: o PDV e a primeira coisa que a cozinha procura. */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operação',
    items: [
      { to: '/pdv', label: 'PDV', icon: ShoppingCart },
      { to: '/cozinha', label: 'Cozinha', icon: ChefHat },
      { to: '/scanner', label: 'Scanner', icon: ScanLine },
    ],
  },
  {
    title: 'Cadastro',
    items: [
      { to: '/insumos', label: 'Insumos', icon: Package },
      { to: '/fichas', label: 'Fichas técnicas', icon: FileText },
      { to: '/notas', label: 'Notas fiscais', icon: Receipt },
    ],
  },
  {
    title: 'Ajustes',
    items: [
      { to: '/configuracoes', label: 'Impressora', icon: Printer },
      { to: '/entrega', label: 'Bairros e taxas', icon: MapPin, financial: true },
    ],
  },
  {
    title: 'Gestão',
    items: [
      { to: '/', label: 'Visão geral', icon: BarChart3, financial: true },
      { to: '/indicadores', label: 'Indicadores', icon: LayoutDashboard, financial: true },
      { to: '/precos', label: 'Preços', icon: Tags, financial: true },
      { to: '/simulador', label: 'Simulador', icon: Calculator, financial: true },
    ],
  },
]

export function App() {
  const { isAuthenticated, loading, user, tenant, logout, canSeeFinancials } = useAuth()
  const [navOpen, setNavOpen] = useState(false)

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
        <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-brand" />
        <p className="text-base font-medium text-ink">Carregando o Delivery ERP</p>
        <p className="text-sm text-slate">Validando a sua sessão...</p>
      </div>
    )
  }

  if (!isAuthenticated) return <LoginPage />

  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase()
  const roleLabel =
    user?.role === 'admin'
      ? 'Administrador'
      : user?.role === 'manager'
        ? 'Gerente'
        : 'Operador'
  const homePath = canSeeFinancials ? '/' : '/pdv'

  return (
    <div className="flex min-h-screen bg-canvas">
      {navOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-30 bg-ink/50 lg:hidden"
        />
      )}

      <nav
        aria-label="Navegação principal"
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-ink transition-transform lg:static lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-5">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-brand font-mono text-sm font-bold text-white"
            >
              D
            </span>
            <span className="text-sm font-semibold tracking-wide text-white">
              Delivery ERP
            </span>
          </div>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Fechar menu"
            className="text-white/60 hover:text-white lg:hidden"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 pb-4">
          <StoreStatusBadge />
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((i) => !i.financial || canSeeFinancials)
            if (items.length === 0) return null
            return (
              <div key={group.title} className="flex flex-col gap-1">
                <p className="px-2 pb-1 text-[0.6875rem] font-semibold tracking-[0.14em] text-white/40 uppercase">
                  {group.title}
                </p>
                {items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    onClick={() => setNavOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                        isActive
                          ? 'bg-brand font-medium text-white'
                          : 'text-white/65 hover:bg-ink-soft hover:text-white'
                      }`
                    }
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-4">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-soft text-xs font-semibold text-white"
          >
            {initials || '--'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="truncate text-xs text-white/50">{roleLabel}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            aria-label="Sair"
            title="Sair"
            className="text-white/50 transition-colors hover:text-white"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:px-8">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Abrir menu"
            className="text-slate hover:text-ink lg:hidden"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
          <h1 className="truncate text-sm font-semibold text-ink">
            {tenant?.name ?? 'Minha loja'}
          </h1>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <Suspense
            fallback={
              <div className="flex items-center gap-2 py-16 text-sm text-slate">
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                Carregando a tela...
              </div>
            }
          >
            <Routes>
              <Route path="/pdv" element={<PDV />} />
              {/* Antes apontava para <PDV />: a cozinha abria o caixa em vez da
                  fila de producao, e o Kanban nunca existiu de fato. */}
              <Route path="/cozinha" element={<KitchenDisplay />} />
              <Route path="/scanner" element={<BarcodeScanner />} />
              <Route path="/configuracoes" element={<PrinterSettings />} />
              <Route path="/insumos" element={<IngredientsManagement />} />
              <Route path="/fichas" element={<TechnicalSheet />} />
              <Route path="/notas" element={<InvoiceImporter />} />

              {/* Telas com dinheiro ficam atras da permissao. Sem este guard,
                  um operador digitava a URL e via a margem da loja. */}
              {canSeeFinancials && (
                <>
                  <Route path="/" element={<DashboardCharts />} />
                  <Route path="/indicadores" element={<DashboardKPIs />} />
                  {/* Taxa de entrega e dinheiro: fica atras da mesma permissao
                      dos precos, senao um operador mudaria o que a loja cobra. */}
                  <Route path="/entrega" element={<DeliveryZones />} />
                  <Route path="/precos" element={<PricingPanel />} />
                  <Route path="/simulador" element={<ImpactSimulator />} />
                </>
              )}

              <Route path="*" element={<Navigate to={homePath} replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  )
}
