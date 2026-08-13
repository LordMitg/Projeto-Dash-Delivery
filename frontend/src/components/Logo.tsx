/**
 * Símbolo da DeliOne: uma cloche, neutra para qualquer tipo de restaurante.
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
      aria-label="DeliOne"
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
        <path d="M14 30h20" />
        <path d="M17 30a7 7 0 0 1 14 0" />
        <path d="M10.5 34h27" />
        <path d="M22 21.5h4" />
        <path d="M24 21.5v1.5" />
      </g>
    </svg>
  )
}
