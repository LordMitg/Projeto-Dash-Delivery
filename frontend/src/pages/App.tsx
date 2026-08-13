import { Suspense, lazy, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Loader2, Menu, ShieldOff } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { AuthGate } from './AuthGate'
import { SideNav } from '../components/SideNav'
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
const OverviewPage = lazy(() =>
  import('../components/dashboard/OverviewPage').then((m) => ({ default: m.OverviewPage })),
)
const OrdersPanel = lazy(() =>
  import('../components/orders/OrdersPanel').then((m) => ({ default: m.OrdersPanel })),
)
const CatalogPage = lazy(() => import('./CatalogPage'))
const ProductEditorPage = lazy(() => import('./ProductEditorPage'))
const PublicStorePage = lazy(() => import('./PublicStorePage'))
const OrderTrackingPage = lazy(() => import('./OrderTrackingPage'))
const StorefrontSettingsPage = lazy(() => import('./StorefrontSettingsPage'))
const PDV = lazy(() => import('../components/PDV').then((m) => ({ default: m.PDV })))
const KitchenDisplay = lazy(() =>
  import('../components/KitchenDisplay').then((m) => ({ default: m.KitchenDisplay })),
)
const ScannerScreen = lazy(() =>
  import('../components/scanner/ScannerScreen').then((m) => ({ default: m.ScannerScreen })),
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

export function App() {
  const { isAuthenticated, loading, user, logout, can, isOwner } = useAuth()
  const [navOpen, setNavOpen] = useState(false)
  // Lido aqui no topo, e nao junto do uso: hooks nao podem ficar depois dos
  // early returns de `loading` / `!isAuthenticated`.
  const location = useLocation()
  const isPdvRoute = location.pathname.startsWith('/pdv')
  const isPublicRoute =
    location.pathname.startsWith('/loja/') || location.pathname.startsWith('/pedido/')

  // A loja digital e o acompanhamento nao dependem da sessao administrativa.
  // Eles precisam ser montados antes do loading/login, inclusive em aba anonima.
  if (isPublicRoute) {
    return (
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#fff8ee]"><Loader2 className="h-6 w-6 animate-spin text-[#4a103a]" /></div>}>
        <Routes>
          <Route path="/loja/:slug" element={<PublicStorePage />} />
          <Route path="/pedido/:token" element={<OrderTrackingPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    )
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
        <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-brand" />
        <p className="text-base font-medium text-ink">Carregando o DeliOne</p>
        <p className="text-sm text-slate">Validando a sua sessão...</p>
      </div>
    )
  }

  // Sem sessao a aplicacao inteira e substituida pela porta de entrada: o
  // <Routes> abaixo pressupoe token, e montar o menu antes disso dispararia
  // requisicoes que voltariam 401.
  if (!isAuthenticated) return <AuthGate />

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
  /**
   * O PDV tem um shell PROPRIO: menu presente, porem recolhido.
   *
   * Antes ele rodava totalmente fora do shell, em tela cheia. O motivo era
   * legitimo — os 256px do menu custavam uma coluna inteira de produtos — mas a
   * cura tinha efeito colateral: a frente de caixa virava um comodo sem porta, e
   * ir para "Cozinha" ou "Caixa" dependia de o operador achar um botao de voltar.
   *
   * O trilho recolhido (~68px) devolve quase todo aquele espaco e mantem a
   * navegacao a um clique. O cabecalho continua ausente: a barra do proprio PDV
   * ja carrega loja, operador e estado do caixa, e empilhar duas barras comeria
   * a altura que a grade precisa. `h-screen` + `overflow-hidden` porque o PDV
   * rola por dentro (grade e comanda), nunca a pagina toda.
   */
  if (isPdvRoute) {
    if (!can('pdv:use')) return <Navigate to="/sem-acesso" replace />
    return (
      <div className="flex h-screen overflow-hidden bg-canvas">
        {/* `key` distinta da do shell de gestao: sem ela o React reaproveita a
            MESMA instancia de SideNav ao trocar de rota (mesma posicao na
            arvore), e o `useState(defaultCollapsed)` — que so roda na montagem —
            nunca reavalia. Na pratica o menu chegava expandido no PDV. */}
        <SideNav
          key="pdv"
          defaultCollapsed
          mobileOpen={navOpen}
          onMobileClose={() => setNavOpen(false)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate">
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                Abrindo o PDV...
              </div>
            }
          >
            <PDV onOpenMenu={() => setNavOpen(true)} />
          </Suspense>
        </div>
      </div>
    )
  }

  const homePath = can('reports:view')
    ? '/'
    : can('pdv:use')
      ? '/pdv'
      : can('kitchen:view')
        ? '/cozinha'
        : can('ingredients:view')
          ? '/insumos'
          : can('products:view')
            ? '/cardapio'
            : '/sem-acesso'

  return (
    <div className="flex min-h-screen bg-canvas">
      <SideNav
        key="gestao"
        mobileOpen={navOpen}
        onMobileClose={() => setNavOpen(false)}
        header={<StoreStatusBadge />}
      />

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
              {/* Duas chaves porque o servidor monta `/api/scanner` com
                  `requirePermission('scanner:use', 'ingredients:manage')`. Quem
                  gerencia insumos mas nao tinha `scanner:use` ficava sem a tela,
                  apesar de o backend aceitar as requisicoes dele. */}
              {(can('scanner:use') || can('ingredients:manage')) && (
                <Route path="/scanner" element={<ScannerScreen />} />
              )}
              {can('ingredients:view') && (
                <Route path="/insumos" element={<IngredientsManagement />} />
              )}
              {can('products:view') && <Route path="/cardapio" element={<CatalogPage />} />}
              {can('products:view') && (
                <>
                  <Route path="/cardapio/produtos/novo" element={<ProductEditorPage />} />
                  <Route path="/cardapio/produtos/:id" element={<ProductEditorPage />} />
                  <Route path="/fichas" element={<Navigate to="/cardapio/produtos/novo" replace />} />
                </>
              )}
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

              {/* Painel de pedidos do balcao. Separado de /cozinha de proposito:
                  a cozinha ve o que produzir, este ve canal, pagamento e atraso.
                  `orders:view` porque o servidor monta /api/dashboard aceitando
                  tambem essa chave — quem toca o turno nao tem `reports:view`. */}
              {(can('orders:view') || can('reports:view')) && (
                <Route path="/pedidos" element={<OrdersPanel />} />
              )}

              {/* Faturamento e indicadores: `reports:view`. */}
              {can('reports:view') && (
                <>
                  {/* A home passou a ser a Visao geral (o dia da operacao). A
                      analise de 12 meses continua existindo em /faturamento: ela
                      responde outra pergunta e nao servia como primeira tela. */}
                  <Route path="/" element={<OverviewPage />} />
                  <Route path="/faturamento" element={<DashboardCharts />} />
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
                  <Route path="/cardapio/loja-digital" element={<StorefrontSettingsPage />} />
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
