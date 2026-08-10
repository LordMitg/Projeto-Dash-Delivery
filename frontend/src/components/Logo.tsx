/**
 * Simbolo da marca: o pudim.
 *
 * Em componente, e nao em <img src="/favicon.svg">, por dois motivos praticos:
 * o traco herda a cor de quem o usa (`currentColor`), entao o mesmo desenho
 * serve no menu vinho e numa superficie clara; e ele entra no bundle, sem uma
 * requisicao extra para aparecer no primeiro carregamento do PDV.
 */

export function Logo({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="Pudim"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="48" height="48" rx="11" className="fill-brand" />
      <g
        className="stroke-brand-ink"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* Corpo: tronco de cone, como um pudim desenformado. */}
        <path d="M13.5 31.5 L18.8 18.5 Q24 15.6 29.2 18.5 L34.5 31.5 Z" />
        {/* Calda escorrendo pela borda de cima. */}
        <path d="M19.4 20.2 q2.4 2.6 4.6 0 q2.3 -2.6 4.6 0" />
        {/* Prato. */}
        <path d="M9.5 31.5 h29" />
      </g>
    </svg>
  )
}
