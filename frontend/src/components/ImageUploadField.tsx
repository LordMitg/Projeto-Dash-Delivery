import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { api, errorMessage, unwrap } from '../lib/api'

interface Props {
  /** Caminho ja gravado (ex.: `/uploads/<tenant>/ab12.jpg`), ou vazio. */
  value: string
  onChange: (url: string) => void
  label?: string
}

/**
 * Campo de envio de imagem.
 *
 * Componente separado, e nao logica embutida no formulario de produto, porque a
 * mesma necessidade ja aparece em mais de um lugar do sistema (produto agora,
 * logo da loja em "Meu negocio" depois) e duplicar isso significaria duplicar
 * tambem a validacao de tipo/tamanho e o tratamento de erro.
 */
export function ImageUploadField({ value, onChange, label = 'Foto' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleFile(file: File) {
    setError('')

    /**
     * Validacao no cliente ANTES de subir — o servidor revalida de todo jeito.
     *
     * Nao e redundancia inutil: sem isto, uma foto de 12 MB tirada no celular
     * sobe inteira pela rede da loja para so entao voltar recusada. Barrando
     * aqui, o operador recebe a resposta na hora.
     */
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Formato não aceito. Envie JPG, PNG ou WEBP.')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      setError('Imagem muito grande. O limite é 4 MB.')
      return
    }

    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', file)
      /**
       * `api.post` direto, e nao o helper `apiPost`: o helper fixa
       * `Content-Type: application/json`, e um FormData precisa que o navegador
       * defina o proprio cabecalho com o `boundary` do multipart. Forcando JSON,
       * o multer nao acha o arquivo e a requisicao falha como "nenhum arquivo
       * enviado". Passar `undefined` deixa o axios remover o padrao.
       */
      const res = await api.post('/api/uploads/product-image', body, {
        headers: { 'Content-Type': undefined },
      })
      const { url } = unwrap<{ url: string }>(res.data)
      onChange(url)
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível enviar a imagem.'))
    } finally {
      setBusy(false)
      // Limpa o input para que escolher O MESMO arquivo de novo volte a disparar
      // o `change` (o navegador nao emite o evento se o valor nao mudou).
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">{label}</span>

      <div className="flex items-center gap-3">
        {/* Pre-visualizacao: e o unico jeito de o operador conferir que subiu a
            foto certa antes de salvar o produto. */}
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-card border border-line bg-canvas">
          {value ? (
            <img src={value} alt="Pré-visualização" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus aria-hidden="true" className="h-6 w-6 text-slate" />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <ImagePlus aria-hidden="true" className="h-4 w-4" />
                  {value ? 'Trocar foto' : 'Escolher foto'}
                </>
              )}
            </button>

            {value && !busy && (
              <button
                type="button"
                onClick={() => {
                  onChange('')
                  setError('')
                }}
                aria-label="Remover foto"
                title="Remover foto"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-slate transition-colors hover:border-bad hover:text-bad"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </button>
            )}
          </div>

          <p className="text-xs text-slate">JPG, PNG ou WEBP, até 4 MB.</p>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  )
}
