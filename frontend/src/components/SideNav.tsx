/**
 * Menu lateral do sistema.
 *
 * Extraido de `pages/App.tsx` porque agora existem DOIS lugares que o desenham:
 * o shell das telas de gestao e o PDV. Mantê-lo inline no App e copiá-lo no PDV
 * significaria duas listas de navegacao para atualizar a cada tela nova — e a do
 * PDV seria sempre a esquecida.
 *
 * ── Recolhivel, e nao fixo ───────────────────────────────────────────────────
 * O PDV rodava em tela cheia, sem menu, porque os 256px custavam uma coluna
 * inteira de produtos. Isso resolvia o espaco e criava outro problema: a frente
 * de caixa virava um beco sem saida visual, e trocar para "Cozinha" ou "Caixa"
 * dependia de o operador descobrir um botao de voltar.
 *
 * O modo recolhido preserva as duas coisas: 60px de trilho com os icones (a
 * navegacao continua a um clique) e ~200px devolvidos a grade. O PDV entra
 * recolhido por padrao; as telas de gestao, expandidas.
 */

import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  BarChart3,
  Calculator,
  ChefHat,
  ChevronLeft,
  ClipboardList,
  FileText,
  Landmark,
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  PanelLeft,
  Printer,
  Receipt,
  ScanLine,
  ShoppingCart,
  Store,
  Tags,
  Users,
  Wallet,
  X,
} from 'lucide-react'

import { useAuth } from '../context/AuthContext'
import { useTenant } from '../context/TenantContext'
import { Logo } from './Logo'

export interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  /**
   * Permissao exigida para o item aparecer. A chave e a MESMA que o backend
   * cobra na rota correspondente.
   */
  permission?: string
  /**
   * Alternativa a `permission` quando a tela e liberada por mais de uma chave.
   * O caixa e o caso: quem so opera o PDV precisa consultar o turno para saber
   * se pode vender, mesmo sem poder abrir ou fechar.
   */
  anyPermission?: string[]
  /** Exclusivo do dono: gestao de equipe e perfil da loja nao sao delegaveis. */
  ownerOnly?: boolean
}

/** Operacao primeiro: o PDV e a primeira coisa que a cozinha procura. */
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
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
      {
        to: '/pedidos',
        label: 'Pedidos',
        icon: ClipboardList,
        anyPermission: ['orders:view', 'reports:view'],
      },
      { to: '/cozinha', label: 'Cozinha', icon: ChefHat, permission: 'kitchen:view' },
      {
        to: '/scanner',
        label: 'Scanner',
        icon: ScanLine,
        anyPermission: ['scanner:use', 'ingredients:manage'],
      },
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
      {
        to: '/indicadores',
        label: 'Indicadores',
        icon: LayoutDashboard,
        permission: 'reports:view',
      },
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

interface Props {
  /** Estado inicial do trilho. O PDV entra recolhido; a gestao, expandida. */
  defaultCollapsed?: boolean
  /** Gaveta aberta no celular, onde o menu e sobreposto em vez de recolhido. */
  mobileOpen: boolean
  onMobileClose: () => void
  /** Conteudo do topo (seletor de loja, estado da loja) — varia por contexto. */
  header?: React.ReactNode
}

export function SideNav({ defaultCollapsed = false, mobileOpen, onMobileClose, header }: Props) {
  const { user, logout, can, isOwner } = useAuth()
  const { activeTenant } = useTenant()
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase()
  // Existem exatamente dois papeis por vinculo: `owner` e `staff`.
  const roleLabel = isOwner ? 'Dono do negócio' : 'Funcionário'

  // No celular a gaveta e SEMPRE larga: recolher para 60px ali nao devolve
  // espaco util (o menu esta sobreposto, nao ao lado) e so tornaria os alvos
  // menores no dispositivo em que o dedo ja e o ponteiro menos preciso.
  const railWidth = collapsed ? 'lg:w-[4.25rem]' : 'lg:w-64'

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={onMobileClose}
          className="fixed inset-0 z-30 bg-ink/60 lg:hidden"
        />
      )}

      <nav
        aria-label="Navegação principal"
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-plum transition-[transform,width] duration-200 lg:static lg:translate-x-0 ${railWidth} ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* ── Assinatura da marca ── */}
        <div
          className={`flex shrink-0 items-center gap-2.5 px-4 py-4 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}
        >
          <Logo className="h-9 w-9 shrink-0" />
          {/* O nome vem do tenant, nao do codigo: quem usa o sistema e a
              "Marmitaria Sabor Caseiro", nao um rotulo generico. `line-clamp-2`
              porque nomes reais de negocio sao longos e o trilho tem 256px. */}
          <span
            className={`font-display text-[1.0625rem] leading-tight text-cream line-clamp-2 ${collapsed ? 'lg:hidden' : ''}`}
            title={activeTenant?.name ?? undefined}
          >
            {activeTenant?.name ?? 'Delivery ERP'}
          </span>

          {/* Fechar (celular) */}
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Fechar menu"
            className="ml-auto text-cream/60 hover:text-cream lg:hidden"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>

          {/* Recolher (desktop) */}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            className={`hidden text-cream/50 transition-colors hover:text-cream lg:block ${
              collapsed ? 'lg:hidden' : 'ml-auto'
            }`}
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* Reabrir quando recolhido: o botao acima some junto com o rotulo, e sem
            este o trilho viraria uma via de mao unica. */}
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expandir menu"
            title="Expandir menu"
            className="mx-auto mb-1 hidden rounded-md p-2 text-cream/50 transition-colors hover:bg-plum-soft hover:text-cream lg:block"
          >
            <PanelLeft aria-hidden="true" className="h-4 w-4" />
          </button>
        )}

        {header && <div className={`px-4 pb-3 ${collapsed ? 'lg:hidden' : ''}`}>{header}</div>}

        {/* ── Itens ── */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2.5 pb-4">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter(
              (i) =>
                (i.ownerOnly ? isOwner : true) &&
                (!i.permission || can(i.permission)) &&
                (!i.anyPermission || i.anyPermission.some((p) => can(p))),
            )
            if (items.length === 0) return null
            return (
              <div key={group.title} className="flex flex-col gap-0.5">
                <p
                  className={`px-2 pb-1 text-[0.625rem] font-semibold tracking-[0.16em] text-cream/35 uppercase ${
                    collapsed ? 'lg:hidden' : ''
                  }`}
                >
                  {group.title}
                </p>
                {items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    onClick={onMobileClose}
                    title={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        collapsed ? 'lg:justify-center lg:px-0' : ''
                      } ${
                        isActive
                          ? // Dourado como PREENCHIMENTO e vinho como texto: o
                            // inverso (letra dourada) nao passa contraste.
                            'bg-brand font-semibold text-brand-ink'
                          : 'text-cream/70 hover:bg-plum-soft hover:text-cream'
                      }`
                    }
                  >
                    <Icon aria-hidden="true" className="h-[1.125rem] w-[1.125rem] shrink-0" />
                    <span className={collapsed ? 'lg:hidden' : ''}>{label}</span>
                  </NavLink>
                ))}
              </div>
            )
          })}
        </div>

        {/* ── Quem esta operando ── */}
        <div
          className={`flex shrink-0 items-center gap-3 border-t border-cream/10 bg-plum-deep px-4 py-3.5 ${
            collapsed ? 'lg:justify-center lg:px-0' : ''
          }`}
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-ink"
          >
            {initials || '--'}
          </span>
          <div className={`min-w-0 flex-1 ${collapsed ? 'lg:hidden' : ''}`}>
            <p className="truncate text-sm font-medium text-cream">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="truncate text-xs text-cream/50">{roleLabel}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            aria-label="Sair"
            title="Sair"
            className={`text-cream/50 transition-colors hover:text-cream ${collapsed ? 'lg:hidden' : ''}`}
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </nav>
    </>
  )
}
