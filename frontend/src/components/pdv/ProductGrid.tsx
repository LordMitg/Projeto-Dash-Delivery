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
 * - **O card inteiro e o botao.** O "+" dourado do canto e a affordance visivel
 *   ("isto entra no pedido"), mas ele NAO e um segundo alvo com acao propria:
 *   dois alvos com o mesmo efeito, um dentro do outro, so criam duvida de onde
 *   tocar e chance de toque duplo. Por isso ele e decorativo (`aria-hidden`) e
 *   reage ao hover do card.
 *
 * ── Sobre a foto ─────────────────────────────────────────────────────────────
 * O card se ADAPTA em vez de reservar um buraco cinza.
 *
 * A grade de referencia e construida sobre fotos, mas produto sem imagem
 * cadastrada ainda e comum aqui. Um placeholder em cada card produziria uma
 * parede de retangulos vazios — pior que nao ter foto, porque o vazio ocuparia
 * justo o espaco de que o nome do produto precisa para ser lido de longe.
 *
 * Entao ha dois layouts, e nao um layout com furo:
 *  - COM foto: imagem no topo, nome e preco embaixo (o desenho da referencia).
 *  - SEM foto: a inicial do produto em um bloco tipografico, e o nome ganha o
 *    espaco que sobra. Le-se bem, e a grade fica homogenea porque os dois casos
 *    tem a mesma altura.
 * Conforme as fotos forem cadastradas, a grade migra sozinha para a referencia.
 */

import { Plus, ScanBarcode, Search, X } from 'lucide-react'

import { brl, productCategory, tintFor, type Product } from './types'

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
      {/* ── Busca + categorias ──
          Sobre o creme, sem barra branca: a referencia trata busca e chips como
          parte da mesma folha de trabalho da grade. O branco fica reservado ao
          campo e aos cards, que sao as superficies que recebem toque. */}
      <div className="flex shrink-0 flex-col gap-3 px-6 pb-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-slate"
          />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar produto ou código   (F2)"
            aria-label="Buscar produto"
            className="w-full rounded-xl border border-line bg-surface py-3 pr-12 pl-11 text-sm text-ink shadow-sm placeholder:text-slate focus:border-brand focus:outline-none"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Limpar busca"
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-1 text-slate transition-colors hover:text-ink"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : (
            /* O leitor de codigo de barras digita no campo focado, entao nao ha
               botao a acionar: o icone existe para dizer que apontar o leitor
               aqui funciona. Decorativo de proposito. */
            <ScanBarcode
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-4 h-4.5 w-4.5 -translate-y-1/2 text-slate/70"
            />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {['Todos', ...categories].map((category) => {
            const active = activeCategory === category
            return (
              <button
                key={category}
                type="button"
                onClick={() => onCategoryChange(category)}
                aria-pressed={active}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-plum text-cream'
                    : 'border border-line bg-surface text-slate hover:border-brand hover:text-ink'
                }`}
              >
                {category}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Grade ── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6">
        {loading ? (
          // Esqueleto com a mesma forma dos cards: evita o salto de layout que
          // faz o operador clicar no lugar errado quando a lista aparece.
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <li key={i} className="h-56 animate-pulse rounded-card bg-line/70" />
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
                    className="group flex h-full w-full flex-col overflow-hidden rounded-card border border-line bg-surface text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand hover:shadow-lg hover:shadow-plum/5 focus:border-brand focus:outline-none active:translate-y-0"
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
                      className={`relative w-full overflow-hidden ${
                        image ? 'aspect-[4/3]' : 'min-h-14 flex-1'
                      }`}
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

                    {/* Texto.
                        SEM foto quem estica e a faixa de cor acima (`flex-1`),
                        e nao este bloco: se o texto esticasse, o card sem foto
                        ficaria com um vazio branco entre o nome e o preco,
                        justamente porque a grade iguala a altura das linhas.
                        Assim o preco de todos os cards fica na mesma altura. */}
                    <div
                      className={`flex min-w-0 flex-col gap-1 px-3.5 py-3 ${image ? 'flex-1' : ''}`}
                    >
                      <p className="line-clamp-2 text-sm leading-snug font-semibold text-balance text-ink">
                        {product.name}
                      </p>
                      <p className="text-[0.625rem] tracking-[0.1em] text-slate uppercase">
                        {productCategory(product)}
                      </p>

                      <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
                        <span className="text-base font-bold tabular-nums text-accent">
                          {brl(Number(product.price) || 0)}
                        </span>
                        {/* Vinho sobre o dourado: dourado nunca e cor de letra. */}
                        <span
                          aria-hidden="true"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink transition-colors group-hover:bg-brand"
                        >
                          <Plus className="h-4 w-4" />
                        </span>
                      </div>
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
