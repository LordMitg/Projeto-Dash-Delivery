import { Suspense, lazy, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  BarChart3,
  Calculator,
  ChefHat,
  FileText,
  Landmark,
  LayoutDashboard,
  Loader2,
  LogOut,
  MapPin,
  Menu,
  Package,
  Printer,
  Receipt,
  ScanLine,
  ShieldOff,
  ShoppingCart,
  Store,
  Tags,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { AuthGate } from './AuthGate'
import { StoreStatusBadge } from '../components/StoreStatusBadge'
import { TenantSwitcher } from '../components/TenantSwitcher'

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
// Telas do dono: um funcionario nunca as abre, entao nao ha motivo para elas
// pesarem no primeiro carregamento do PDV.
const MyBusinessPage = lazy(() => import('./MyBusinessPage'))
const EmployeesPage = lazy(() => import('./EmployeesPage'))
// Caixa e contas a pagar: o PDV ja apontava para `/caixa` antes destas telas
// existirem, e o clique em "Abrir o caixa" nao levava a lugar nenhum.
const CashRegisterPage = lazy(() => import('./CashRegisterPage'))
const PayablesPage = lazy(() => import('./PayablesPage'))
const PricingPanel = lazy(() => import('../components/PricingPanel'))
const TechnicalSheet = lazy(() => import('../components/TechnicalSheet'))
const InvoiceImporter = lazy(() => import('../components/InvoiceImporter'))

/**
 * Tela de quem entrou mas ainda nao recebeu nenhuma permissao.
 *
 * Sem ela o funcionario recem-cadastrado veria a area de trabalho vazia e
 * concluiria que o sistema esta quebrado. Aqui ele le o motivo e sabe a quem
 * pedir.
 */
function NoAccess() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
      <ShieldOff aria-hidden="true" className="h-8 w-8 text-slate" />
      <h2 className="text-lg font-semibold text-ink">Nenhuma tela liberada ainda</h2>
      <p className="text-sm leading-relaxed text-slate">
        Sua conta está ativa, mas o dono do negócio ainda não marcou o que você pode
        acessar. Peça a ele para liberar as telas do seu trabalho.
      </p>
    </div>
  )
}

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  /**
   * Permissao exigida para o item aparecer. A chave e a MESMA que o backend
   * cobra na rota correspondente.
   *
   * Antes existia uma flag `financial` que agrupava tudo que envolvia dinheiro.
   * Ela nao servia mais: o dono agora libera permissao por permissao, e um caixa
   * autorizado a consultar preco (`pricing:view`) sem ver faturamento
   * (`reports:view`) era impossivel de representar com um booleano so.
   */
  permission?: string
  /**
   * Alternativa a `permission` quando a tela e liberada por mais de uma chave.
   *
   * O caixa e o caso: o servidor monta `/api/cash` com
   * `requirePermission('cash:operate', 'cash:close', 'pdv:use')` — quem so opera
   * o PDV precisa consultar o turno para saber se pode vender, mesmo sem poder
   * abrir ou fechar. Com um `permission` unico o item sumiria para o operador e
   * o link que o proprio PDV oferece cairia no vazio.
   */
  anyPermission?: string[]
  /** Exclusivo do dono: gestao de equipe e perfil da loja nao sao delegaveis. */
  ownerOnly?: boolean
}

/** Operacao primeiro: o PDV e a primeira coisa que a cozinha procura. */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operação',
    items: [
      { to: '/pdv', label: 'PDV', icon: ShoppingCart, permission: 'pdv:use' },
      {
        to: '/caixa',
        label: 'Caixa',
        icon: Wallet,
        anyPermission: ['cash:operate', 'cash:close', 'pdv:use'],
      },
      { to: '/cozinha', label: 'Cozinha', icon: ChefHat, permission: 'kitchen:view' },
      { to: '/scanner', label: 'Scanner', icon: ScanLine, permission: 'scanner:use' },
    ],
  },
  {
    title: 'Cadastro',
    items: [
      { to: '/insumos', label: 'Insumos', icon: Package, permission: 'ingredients:view' },
      { to: '/fichas', label: 'Fichas técnicas', icon: FileText, permission: 'products:view' },
      { to: '/notas', label: 'Notas fiscais', icon: Receipt, permission: 'invoices:manage' },
    ],
  },
  {
    title: 'Gestão',
    items: [
      { to: '/', label: 'Visão geral', icon: BarChart3, permission: 'reports:view' },
      { to: '/indicadores', label: 'Indicadores', icon: LayoutDashboard, permission: 'reports:view' },
      {
        to: '/contas',
        label: 'Contas a pagar',
        icon: Landmark,
        anyPermission: ['payables:view', 'payables:manage'],
      },
      { to: '/precos', label: 'Preços', icon: Tags, permission: 'pricing:view' },
      { to: '/simulador', label: 'Simulador', icon: Calculator, permission: 'pricing:view' },
    ],
  },
  {
    title: 'Ajustes',
    items: [
      { to: '/negocio', label: 'Meu negócio', icon: Store, ownerOnly: true },
      { to: '/equipe', label: 'Funcionários', icon: Users, ownerOnly: true },
      { to: '/entrega', label: 'Bairros e taxas', icon: MapPin, permission: 'delivery:manage' },
      { to: '/configuracoes', label: 'Impressora', icon: Printer, permission: 'printer:manage' },
    ],
  },
]

export function App() {
  const { isAuthenticated, loading, user, logout, can, isOwner } = useAuth()
  const [navOpen, setNavOpen] = useState(false)
  // Lido aqui no topo, e nao junto do uso: hooks nao podem ficar depois dos
  // early returns de `loading` / `!isAuthenticated`.
  const isPdvRoute = useLocation().pathname.startsWith('/pdv')

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
        <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-brand" />
        <p className="text-base font-medium text-ink">Carregando o Delivery ERP</p>
        <p className="text-sm text-slate">Validando a sua sessão...</p>
      </div>
    )
  }

  // Sem sessao a aplicacao inteira e substituida pela porta de entrada: o
  // <Routes> abaixo pressupoe token, e montar o menu antes disso dispararia
  // requisicoes que voltariam 401.
  if (!isAuthenticated) return <AuthGate />

  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase()
  // Existem exatamente dois papeis por vinculo: `owner` e `staff`. Os rotulos
  // antigos ("Administrador", "Gerente") vinham do modelo anterior, em que o
  // cargo definia o acesso — hoje quem define e a lista de permissoes, e exibir
  // "Gerente" sugeriria um poder que o cargo nao carrega mais.
  const roleLabel = isOwner ? 'Dono do negócio' : 'Funcionário'

  /**
   * Para onde mandar quem digita uma URL inexistente.
   *
   * Nao pode ser fixo em '/': essa e a visao geral, que exige `reports:view`. Um
   * garcom cairia numa rota inexistente para ele e o `Navigate` de fallback o
   * jogaria de volta ali, em loop. Mandamos cada um para a primeira tela que ele
   * realmente pode abrir.
   *
   * O ultimo caso ('/sem-acesso') existe justamente para fechar esse loop: um
   * funcionario recem-criado, ainda sem nenhuma caixa marcada, precisa de UMA
   * rota valida para onde ir.
   */
  // O PDV roda FORA do shell: sem menu lateral, sem cabecalho, ocupando a tela
  // inteira. Numa frente de caixa cada pixel conta, e os 256px do menu custavam
  // uma coluna inteira de produtos. A propria tela oferece o botao de voltar.
  if (isPdvRoute) {
    if (!can('pdv:use')) return <Navigate to="/sem-acesso" replace />
    return <PDV />
  }

  const homePath = can('reports:view')
    ? '/'
    : can('pdv:use')
      ? '/pdv'
      : can('kitchen:view')
        ? '/cozinha'
        : can('ingredients:view')
          ? '/insumos'
          : '/sem-acesso'

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
            const items = group.items.filter(
              (i) =>
                (i.ownerOnly ? isOwner : true) &&
                (!i.permission || can(i.permission)) &&
                (!i.anyPermission || i.anyPermission.some((p) => can(p))),
            )
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
          {/* O nome da loja virou o alternador: e o mesmo lugar onde o dono
              procura "em qual negocio eu estou", entao clicar ali para trocar e
              o gesto esperado. */}
          <h1 className="min-w-0 truncate">
            <TenantSwitcher />
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
            {/* Cada rota e registrada apenas se a permissao existe. Uma rota
                ausente cai no `*` e volta para a home de quem esta logado — e o
                que impede um funcionario de alcancar uma tela digitando a URL.
                Esconder so o item do menu nao bastava. */}
            <Routes>
              {/* /pdv nao aparece aqui: e tratado antes do shell, em tela cheia. */}
              {/* Antes apontava para <PDV />: a cozinha abria o caixa em vez da
                  fila de producao, e o Kanban nunca existiu de fato. */}
              {can('kitchen:view') && <Route path="/cozinha" element={<KitchenDisplay />} />}
              {can('scanner:use') && <Route path="/scanner" element={<BarcodeScanner />} />}
              {can('ingredients:view') && (
                <Route path="/insumos" element={<IngredientsManagement />} />
              )}
              {can('products:view') && <Route path="/fichas" element={<TechnicalSheet />} />}
              {can('invoices:manage') && <Route path="/notas" element={<InvoiceImporter />} />}
              {can('printer:manage') && (
                <Route path="/configuracoes" element={<PrinterSettings />} />
              )}

              {/* Caixa: as tres chaves espelham o mount do servidor. `pdv:use`
                  entra porque o operador precisa consultar o turno para saber se
                  pode vender — a propria tela esconde abertura e fechamento de
                  quem nao tem `cash:operate` / `cash:close`. */}
              {(can('cash:operate') || can('cash:close') || can('pdv:use')) && (
                <Route path="/caixa" element={<CashRegisterPage />} />
              )}

              {(can('payables:view') || can('payables:manage')) && (
                <Route path="/contas" element={<PayablesPage />} />
              )}

              {/* Faturamento e indicadores: `reports:view`. */}
              {can('reports:view') && (
                <>
                  <Route path="/" element={<DashboardCharts />} />
                  <Route path="/indicadores" element={<DashboardKPIs />} />
                </>
              )}

              {/* Preco e simulador tem permissao propria: um caixa pode precisar
                  consultar preco sem ver o faturamento da loja. */}
              {can('pricing:view') && (
                <>
                  <Route path="/precos" element={<PricingPanel />} />
                  <Route path="/simulador" element={<ImpactSimulator />} />
                </>
              )}

              {/* Taxa por bairro tem a propria chave: define quanto a loja cobra
                  do cliente, e nao e a mesma decisao de ver relatorio. */}
              {can('delivery:manage') && <Route path="/entrega" element={<DeliveryZones />} />}

              {/* Perfil da loja e equipe: exclusivos do dono, sem permissao
                  delegavel. Delegar "gerenciar funcionarios" permitiria que o
                  funcionario se promovesse a dono e tomasse a loja. */}
              {isOwner && (
                <>
                  <Route path="/negocio" element={<MyBusinessPage />} />
                  <Route path="/equipe" element={<EmployeesPage />} />
                </>
              )}

              {/* Sempre registrada: e o destino de quem ainda nao tem nenhuma
                  permissao marcada, e sem ela o `*` abaixo entraria em loop. */}
              <Route path="/sem-acesso" element={<NoAccess />} />

              <Route path="*" element={<Navigate to={homePath} replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  )
}
