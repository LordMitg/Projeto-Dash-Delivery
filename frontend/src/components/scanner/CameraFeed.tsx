/**
 * Visor da camera com deteccao de codigos.
 *
 * Extraido do `BarcodeScanner` original para poder servir aos dois modos da
 * tela (codigo de barras e QR da nota) sem duplicar o ciclo de vida da camera,
 * que e a parte facil de errar: uma track nao encerrada deixa o LED aceso e o
 * Android segurando o dispositivo depois de sair da tela.
 *
 * Notas de plataforma que explicam o codigo:
 *
 * - `getUserMedia` exige contexto seguro. Em `http://192.168.x.x` a camera nao
 *   abre: por isso o aviso explicito de HTTPS em vez de um erro cru do
 *   navegador, que faria o operador achar que o app quebrou.
 * - `BarcodeDetector` e nativo no Chrome/Android e ausente no Safari/iOS. O
 *   pacote `barcode-detector` entra como ponyfill, entao o mesmo codigo serve
 *   nos dois. Ele entra por `import()` dinamico para o wasm nao pesar no bundle
 *   de quem so usa o PDV.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, Loader2, ScanLine, ShieldAlert } from 'lucide-react'
// `import type` e apagado na compilacao, entao isto NAO arrasta o wasm para o
// bundle — o carregamento continua sendo so o `import()` dinamico lá embaixo.
import type { BarcodeFormat } from 'barcode-detector/ponyfill'

export type CameraState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'denied'
  | 'unsupported'
  | 'insecure'

interface CameraFeedProps {
  /**
   * Formatos aceitos. QR para nota, EAN/UPC/Code128 para embalagem.
   *
   * Tipado com o `BarcodeFormat` do proprio pacote em vez de `string[]`: um
   * formato escrito errado ("ean13" sem o underscore) e aceito pelo detector em
   * silencio e simplesmente nunca casa, produzindo uma camera que "nao le nada"
   * sem nenhum erro para investigar.
   */
  formats: BarcodeFormat[]
  /** Chamado quando um codigo NOVO aparece no enquadramento. */
  onDetect: (value: string) => void
  /** Texto da guia de enquadramento. */
  hint: string
  /** Guia quadrada (QR) ou deitada (codigo de barras). */
  guide: 'square' | 'wide'
  /**
   * Muda para forcar o esquecimento do ultimo codigo lido, permitindo reler o
   * MESMO codigo de proposito. Sem isso, corrigir um erro exigiria apontar a
   * camera para outra coisa antes de voltar.
   */
  resetToken?: number
}

export function CameraFeed({
  formats,
  onDetect,
  hint,
  guide,
  resetToken = 0,
}: CameraFeedProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<number | null>(null)
  // Evita disparar repetidamente enquanto o mesmo codigo continua enquadrado —
  // sem esta trava, uma leitura vira dezenas de requisicoes.
  const lastCodeRef = useRef<string>('')

  // O callback vive numa ref para o loop de deteccao nao precisar ser
  // recriado (e a camera reiniciada) a cada render do componente pai.
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect

  const [cameraState, setCameraState] = useState<CameraState>('idle')

  useEffect(() => {
    lastCodeRef.current = ''
  }, [resetToken])

  const stopCamera = useCallback(() => {
    if (loopRef.current !== null) {
      window.clearInterval(loopRef.current)
      loopRef.current = null
    }
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

      const { BarcodeDetector } = await import('barcode-detector/ponyfill')
      const detector = new BarcodeDetector({ formats })

      setCameraState('running')

      loopRef.current = window.setInterval(async () => {
        const video = videoRef.current
        if (!video || video.readyState < 2) return
        try {
          const codes = await detector.detect(video)
          const value = codes[0]?.rawValue
          if (value && value !== lastCodeRef.current) {
            lastCodeRef.current = value
            // Vibra para confirmar: numa cozinha barulhenta o operador nao ouve
            // nada e nem sempre esta olhando a tela.
            navigator.vibrate?.(80)
            onDetectRef.current(value)
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
  }, [formats])

  // Encerra a camera ao desmontar (sair da tela ou trocar de modo).
  useEffect(() => stopCamera, [stopCamera])

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-video max-h-72 overflow-hidden rounded-md bg-ink">
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="Visor da câmera"
          className="h-full w-full object-cover"
        />

        {cameraState === 'running' && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3"
          >
            <div
              className={
                guide === 'square'
                  ? 'aspect-square h-40 rounded-lg border-2 border-brand/80'
                  : 'h-24 w-4/5 rounded-md border-2 border-brand/80'
              }
            />
            <p className="rounded bg-ink/70 px-2 py-1 text-xs font-medium text-white">
              {hint}
            </p>
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
                {/* Aponta para `pnpm dev:mobile` e nao para a variavel crua: o
                    script tambem imprime o endereco e o QR de acesso, que era o
                    passo seguinte que o usuario tinha de descobrir sozinho. */}
                <p className="text-sm text-white/70">
                  A câmera só funciona em HTTPS. No computador, pare o servidor e rode{' '}
                  <code className="font-mono text-white">pnpm dev:mobile</code> — ele mostra
                  um QR Code para abrir no celular.
                </p>
                <p className="text-xs text-white/50">
                  Enquanto isso, dá para lançar tudo pela digitação manual.
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
  )
}

export default CameraFeed
