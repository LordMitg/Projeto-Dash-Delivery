/**
 * Grade de produtos do PDV.
 *
 * Decisoes de interface que vieram da operacao, nao da estetica:
 *
 * - **Alvos grandes.** Cada card tem area de toque generosa. O PDV roda em tela
 *   sensivel ao toque com o operador em pe e com pressa; card pequeno gera toque
 *   errado, e toque errado no PDV significa item errado na comanda.
 * - **Preco sempre visivel.** O operador confirma o valor em voz alta para o
 *   cliente; esconder o preco no hover obrigaria a abrir o item para conferir.
 * - **Sem imagens por padrao.** A maioria dos cadastros nao tem foto, e um
 *   quadro cinza de placeholder rouba o espaco que o nome do produto precisa.
 *   Quando a foto existe, ela entra como faixa lateral discreta.
 */

import { Search, X } from 'lucide-react'

import { brl, productCategory, type Product } from './types'

interface Props {
  products: Product[]
  categories: string[]
  activeCategory: string
  search: string
  loading: boolean
  onSearchChange: (value: string) => void
  onCategoryChange: (category: string) => void
  onPick: (product: Product) => void
  searchRef?: React.RefObject<HTMLInputElement | null>
}

export function ProductGrid({
  products,
  categories,
  activeCategory,
  search,
  loading,
  onSearchChange,
  onCategoryChange,
  onPick,
  searchRef,
}: Props) {
  return (
    <section aria-label="Produtos" className="flex min-h-0 flex-1 flex-col">
      {/* Busca + categorias */}
      <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/40"
          />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar produto por nome ou código   (F2)"
            aria-label="Buscar produto"
            className="w-full rounded-md border border-white/10 bg-ink-soft py-2.5 pr-9 pl-9 text-sm text-white placeholder:text-white/40 focus:border-brand focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Limpar busca"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-white/40 transition-colors hover:text-white"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {['Todos', ...categories].map((category) => {
            const active = activeCategory === category
            return (
              <button
                key={category}
                type="button"
                onClick={() => onCategoryChange(category)}
                aria-pressed={active}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-brand text-white'
                    : 'bg-ink-soft text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                {category}
              </button>
            )
          })}
        </div>
      </div>

      {/* Grade */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          // Esqueleto com a mesma forma dos cards: evita o salto de layout que
          // faz o operador clicar no lugar errado quando a lista aparece.
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="h-28 animate-pulse rounded-card bg-ink-soft" />
            ))}
          </ul>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <p className="text-sm font-medium text-white/70">Nenhum produto encontrado</p>
            <p className="text-xs text-white/40">
              {search ? 'Tente outro termo de busca.' : 'Cadastre produtos para vender no PDV.'}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => {
              const hasOptions =
                (product.comboOptions?.length ?? 0) > 0 || (product.addons?.length ?? 0) > 0
              return (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => onPick(product)}
                    className="flex h-full min-h-28 w-full flex-col justify-between gap-2 rounded-card border border-white/10 bg-ink-soft p-3 text-left transition-all hover:border-brand hover:bg-white/5 focus:border-brand focus:outline-none active:scale-[0.98]"
                  >
                    <div className="min-w-0">
                      <p className="text-sm leading-snug font-semibold text-balance text-white">
                        {product.name}
                      </p>
                      <p className="mt-1 text-[0.6875rem] tracking-wide text-white/40 uppercase">
                        {productCategory(product)}
                      </p>
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <span className="font-mono text-base font-bold tabular-nums text-brand">
                        {brl(Number(product.price) || 0)}
                      </span>
                      {hasOptions && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-white/60">
                          opções
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
