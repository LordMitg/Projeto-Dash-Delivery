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
 *
 * ── Sobre a foto ─────────────────────────────────────────────────────────────
 * O card se ADAPTA em vez de reservar um buraco cinza.
 *
 * A grade de referencia e construida sobre fotos, mas nenhum produto cadastrado
 * aqui tem imagem. Um placeholder em cada card produziria uma parede de
 * retangulos vazios — pior que nao ter foto, porque o vazio ocuparia justo o
 * espaco de que o nome do produto precisa para ser lido de longe.
 *
 * Entao ha dois layouts, e nao um layout com furo:
 *  - COM foto: imagem no topo, nome e preco embaixo (o desenho da referencia).
 *  - SEM foto: a inicial do produto em um bloco tipografico, e o nome ganha o
 *    espaco que sobra. Le-se bem, e a grade fica homogenea porque os dois casos
 *    tem a mesma altura.
 * Conforme as fotos forem cadastradas, a grade migra sozinha para a referencia.
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

/**
 * Cor de fundo estavel para o card sem foto.
 *
 * Derivada do nome, e nao aleatoria: o mesmo produto precisa ter sempre a mesma
 * cor. O operador decora a posicao e a cor dos itens que mais vende, e uma cor
 * que muda a cada renderizacao destruiria essa memoria — alem de fazer a tela
 * "piscar" de cor a cada busca.
 */
const TILE_TINTS = [
  'bg-[#f3e2d3] text-[#7a4a1d]',
  'bg-[#e7ecdd] text-[#4a5a32]',
  'bg-[#f1dfe4] text-[#7d3a52]',
  'bg-[#e3e6ef] text-[#3f4a6b]',
  'bg-[#f5e6c8] text-[#79571a]',
  'bg-[#dee9e8] text-[#325450]',
]

function tintFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  // O `??` e exigido pelo `noUncheckedIndexedAccess` do projeto. O modulo ja
  // garante um indice valido, mas o fallback evita silenciar a checagem com `!`.
  return TILE_TINTS[hash % TILE_TINTS.length] ?? TILE_TINTS[0]!
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
    <section aria-label="Produtos" className="flex min-h-0 flex-1 flex-col bg-canvas">
      {/* ── Busca + categorias ── */}
      <div className="flex shrink-0 flex-col gap-3 border-b border-line bg-surface px-5 py-4">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate"
          />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar produto por nome ou código   (F2)"
            aria-label="Buscar produto"
            className="w-full rounded-lg border border-line bg-canvas py-2.5 pr-9 pl-10 text-sm text-ink placeholder:text-slate focus:border-brand focus:bg-surface focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Limpar busca"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-slate transition-colors hover:text-ink"
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
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-plum text-cream'
                    : 'bg-canvas text-slate hover:bg-line hover:text-ink'
                }`}
              >
                {category}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Grade ── */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {loading ? (
          // Esqueleto com a mesma forma dos cards: evita o salto de layout que
          // faz o operador clicar no lugar errado quando a lista aparece.
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <li key={i} className="h-44 animate-pulse rounded-card bg-line/70" />
            ))}
          </ul>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <p className="text-sm font-medium text-ink">Nenhum produto encontrado</p>
            <p className="text-xs text-slate">
              {search ? 'Tente outro termo de busca.' : 'Cadastre produtos para vender no PDV.'}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {products.map((product) => {
              const hasOptions =
                (product.comboOptions?.length ?? 0) > 0 || (product.addons?.length ?? 0) > 0
              const image = product.imageUrl?.trim()

              return (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => onPick(product)}
                    className="group flex h-full w-full flex-col overflow-hidden rounded-card border border-line bg-surface text-left transition-all hover:-translate-y-0.5 hover:border-brand hover:shadow-lg hover:shadow-plum/5 focus:border-brand focus:outline-none active:translate-y-0"
                  >
                    {/* Bloco visual: foto quando existe, faixa com a inicial
                        quando nao.
                        As duas proporcoes sao DIFERENTES de proposito. A foto
                        ganha 4/3 porque ali a imagem e que identifica o prato. A
                        inicial nao identifica nada — ampliada a esse tamanho ela
                        so empurra nome e preco para baixo, e o operador passa a
                        rolar para achar o que ja caberia na tela. Em faixa baixa
                        ela cumpre o unico papel que tem: uma ancora de cor para
                        o olho reencontrar o item na grade. */}
                    <div
                      className={`relative w-full overflow-hidden ${image ? 'aspect-[4/3]' : 'h-14'}`}
                    >
                      {image ? (
                        <img
                          src={image || '/placeholder.svg'}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                        />
                      ) : (
                        <div
                          aria-hidden="true"
                          className={`flex h-full w-full items-center justify-center ${tintFor(product.name)}`}
                        >
                          <span className="font-display text-2xl leading-none opacity-60">
                            {product.name.trim().charAt(0).toUpperCase() || '?'}
                          </span>
                        </div>
                      )}

                      {hasOptions && (
                        <span className="absolute top-2 right-2 rounded-full bg-plum/85 px-2 py-0.5 text-[0.625rem] font-semibold text-cream backdrop-blur-sm">
                          opções
                        </span>
                      )}
                    </div>

                    {/* Texto */}
                    <div className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5">
                      <p className="line-clamp-2 text-sm leading-snug font-semibold text-balance text-ink">
                        {product.name}
                      </p>
                      <p className="text-[0.625rem] tracking-[0.1em] text-slate uppercase">
                        {productCategory(product)}
                      </p>
                      <span className="mt-auto pt-1 text-base font-bold tabular-nums text-accent">
                        {brl(Number(product.price) || 0)}
                      </span>
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
