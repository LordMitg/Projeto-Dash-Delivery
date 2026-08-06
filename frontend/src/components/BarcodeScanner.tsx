/**
 * Scanner de codigo de barras pela camera do celular (PWA).
 *
 * Consulta `GET /api/products/barcode/:code`, que ja existia no backend sem
 * nenhuma tela que o usasse.
 *
 * Notas de plataforma que explicam o codigo:
 *
 * - `getUserMedia` exige contexto seguro. Em `http://192.168.x.x` a camera nao
 *   abre: por isso o aviso explicito de HTTPS em vez de um erro cru do
 *   navegador, que faria o operador achar que o app quebrou.
 * - `BarcodeDetector` e nativo no Chrome/Android e ausente no Safari/iOS. O
 *   pacote `barcode-detector` entra como polyfill, entao o mesmo codigo serve
 *   nos dois.
 * - A digitacao manual existe porque bobina amassada, embalagem molhada e
 *   camera ruim acontecem — sem esse caminho o operador ficaria travado.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Loader2, ScanLine, ShieldAlert } from 'lucide-react'
import { apiGet, errorMessage } from '../lib/api'

interface ScannedProduct {
  id: string
  name: string
  price: string
  barcode?: string | null
  category?: string | null
  stock?: number | null
}

type CameraState = 'idle' | 'starting' | 'running' | 'denied' | 'unsupported' | 'insecure'

export function BarcodeScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<number | null>(null)
  // Evita consultar a API repetidamente enquanto o mesmo codigo continua no
  // enquadramento — sem esta trava, uma leitura vira dezenas de requisicoes.
  const lastCodeRef = useRef<string>('')

  const [cameraState, setCameraState] = useState<CameraState>('idle')
  const [manualCode, setManualCode] = useState('')
  const [product, setProduct] = useState<ScannedProduct | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  const lookup = useCallback(async (code: string) => {
    const clean = code.trim()
    if (!clean) return
    setSearching(true)
    setLookupError(null)
    try {
      const found = await apiGet<ScannedProduct>(`/api/products/barcode/${encodeURIComponent(clean)}`)
      setProduct(found)
    } catch (err) {
      setProduct(null)
      setLookupError(errorMessage(err, `Nenhum produto com o codigo ${clean}.`))
    } finally {
      setSearching(false)
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (loopRef.current !== null) {
      window.clearInterval(loopRef.current)
      loopRef.current = null
    }
    // Parar as tracks e obrigatorio: sem isso o LED da camera fica aceso e o
    // Android mantem o app segurando o dispositivo depois de sair da tela.
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraState('idle')
  }, [])

  const startCamera = useCallback(async () => {
    if (!window.isSecureContext) {
      setCameraState('insecure')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unsupported')
      return
    }

    setCameraState('starting')
    try {
      // `environment` = camera de tras, a que aponta para a embalagem.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      // Import dinamico: o polyfill (e o wasm que ele carrega) so baixa quando
      // alguem realmente abre a camera, nao no bundle de quem usa o PDV.
      const { BarcodeDetector } = await import('barcode-detector/ponyfill')
      const detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'],
      })

      setCameraState('running')

      loopRef.current = window.setInterval(async () => {
        const video = videoRef.current
        if (!video || video.readyState < 2) return
        try {
          const codes = await detector.detect(video)
          const value = codes[0]?.rawValue
          if (value && value !== lastCodeRef.current) {
            lastCodeRef.current = value
            // Vibra para confirmar a leitura: numa cozinha barulhenta o
            // operador nao ouve nada e nem sempre olha a tela.
            navigator.vibrate?.(80)
            void lookup(value)
          }
        } catch {
          // Quadro ilegivel e normal (desfoque, reflexo). Ignora e tenta o
          // proximo em vez de derrubar o loop inteiro.
        }
      }, 400)
    } catch (err) {
      const name = (err as { name?: string })?.name
      setCameraState(name === 'NotAllowedError' ? 'denied' : 'unsupported')
    }
  }, [lookup])

  // Encerra a camera ao sair da tela.
  useEffect(() => stopCamera, [stopCamera])

  return (
    <section aria-labelledby="scanner-title" className="flex max-w-2xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 id="scanner-title" className="text-xl font-semibold text-ink">
          Scanner de código de barras
        </h2>
        <p className="text-sm text-slate">
          Aponte a câmera para a embalagem ou digite o código abaixo.
        </p>
      </header>

      {/* Resultado e erro ficam logo abaixo do titulo, na propria ordem do DOM.
          Antes estavam no fim do markup e so subiam via `order` do flexbox — o
          que invertia titulo e resultado e desalinhava a ordem de leitura.
          Aqui, ordem visual e ordem para leitor de tela sao a mesma. */}
      {lookupError && (
        <p
          role="alert"
          className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad"
        >
          {lookupError}
        </p>
      )}

      {product && (
        <article
          aria-live="polite"
          className="flex flex-col gap-2 rounded-lg border border-good/30 bg-good-soft p-4"
        >
          <h3 className="text-base font-semibold text-ink">{product.name}</h3>
          <p className="font-mono text-lg font-bold text-good">
            R$ {Number(product.price).toFixed(2).replace('.', ',')}
          </p>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate">
            {product.category && (
              <div className="flex gap-1.5">
                <dt>Categoria:</dt>
                <dd className="text-ink">{product.category}</dd>
              </div>
            )}
            {product.barcode && (
              <div className="flex gap-1.5">
                <dt>Código:</dt>
                <dd className="font-mono text-ink">{product.barcode}</dd>
              </div>
            )}
            {product.stock != null && (
              <div className="flex gap-1.5">
                <dt>Estoque:</dt>
                {/* Estoque zerado em vermelho e negrito: lido como um numero
                    neutro, o operador vendia um item que nao existe. */}
                <dd
                  className={
                    Number(product.stock) <= 0 ? 'font-semibold text-bad' : 'text-ink'
                  }
                >
                  {product.stock}
                  {Number(product.stock) <= 0 ? ' — sem estoque' : ''}
                </dd>
              </div>
            )}
          </dl>
        </article>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        {/* Visor compacto: em 4/3 ele empurrava o resultado da leitura para
            fora da tela, e no celular o operador escaneava sem ver o produto.
            `max-h` limita a altura em telas largas sem esticar a imagem. */}
        <div className="relative aspect-video max-h-64 overflow-hidden rounded-md bg-ink">
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="Visor da câmera"
            className="h-full w-full object-cover"
          />

          {cameraState === 'running' && (
            // Guia de enquadramento: sem uma marca central o operador nao sabe
            // onde posicionar o codigo e fica varrendo a embalagem.
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div className="h-24 w-4/5 rounded-md border-2 border-brand/80" />
            </div>
          )}

          {cameraState !== 'running' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              {cameraState === 'starting' ? (
                <>
                  <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-white/70" />
                  <p className="text-sm text-white/70">Abrindo a câmera...</p>
                </>
              ) : cameraState === 'denied' ? (
                <>
                  <CameraOff aria-hidden="true" className="h-6 w-6 text-white/70" />
                  <p className="text-sm text-white/70">
                    Permissão de câmera negada. Libere o acesso nas configurações do
                    navegador e tente de novo.
                  </p>
                </>
              ) : cameraState === 'insecure' ? (
                <>
                  <ShieldAlert aria-hidden="true" className="h-6 w-6 text-white/70" />
                  <p className="text-sm text-white/70">
                    A câmera exige HTTPS. Rode com{' '}
                    <code className="font-mono text-white">VITE_HTTPS=true pnpm dev</code> para
                    usar pelo celular. A digitação manual funciona normalmente.
                  </p>
                </>
              ) : cameraState === 'unsupported' ? (
                <>
                  <CameraOff aria-hidden="true" className="h-6 w-6 text-white/70" />
                  <p className="text-sm text-white/70">
                    Este dispositivo não expõe uma câmera utilizável. Use a digitação
                    manual.
                  </p>
                </>
              ) : (
                <>
                  <ScanLine aria-hidden="true" className="h-6 w-6 text-white/50" />
                  <p className="text-sm text-white/60">Câmera desligada</p>
                </>
              )}
            </div>
          )}
        </div>

        {cameraState === 'running' ? (
          <button
            type="button"
            onClick={stopCamera}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-canvas"
          >
            <CameraOff aria-hidden="true" className="h-4 w-4" />
            Desligar câmera
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startCamera()}
            disabled={cameraState === 'starting'}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-60"
          >
            <Camera aria-hidden="true" className="h-4 w-4" />
            Ligar câmera
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void lookup(manualCode)
          // Limpa o campo apos disparar a busca. Sem isso, cada leitura era
          // CONCATENADA a anterior ("789..." + "000..."), e um leitor de codigo
          // de barras — que digita e da Enter sozinho — encadeava codigos
          // invalidos a cada bipe.
          setManualCode('')
        }}
        className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4"
      >
        <label htmlFor="manual-code" className="text-sm font-medium text-ink">
          Digitar o código
        </label>
        <div className="flex gap-2">
          <input
            id="manual-code"
            value={manualCode}
            // Codigo de barras (EAN/UPC) e numerico: filtrar aqui evita que
            // espacos ou letras vindos de um leitor mal configurado gerem uma
            // busca que nunca encontraria nada.
            onChange={(e) => setManualCode(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            placeholder="7891234567890"
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink"
          />
          <button
            type="submit"
            disabled={searching || !manualCode.trim()}
            className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink-soft disabled:opacity-60"
          >
            {searching ? 'Buscando...' : 'Buscar'}
          </button>
        </div>
      </form>

    </section>
  )
}

export default BarcodeScanner
