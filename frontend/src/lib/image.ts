/**
 * Preparo do logo da loja antes do envio.
 *
 * Como o logo e armazenado: data URL na coluna `Tenant.logoData`. Nao ha bucket
 * nem CDN, e isso e deliberado — cada loja tem UM logo de ~20KB, entao o volume
 * total e irrelevante, e o data URL vem junto do `/auth/me` que a aplicacao ja
 * faz. Um storage externo custaria uma dependencia, credenciais e uma segunda
 * requisicao por tela para resolver um problema de escala que nao existe aqui.
 *
 * O servidor recusa acima de ~400 mil caracteres (`MAX_LOGO_CHARS`). Uma foto de
 * celular estoura isso com folga, e o dono levaria um erro sem entender por que.
 * Redimensionar no navegador ataca a causa em vez de reclamar do sintoma.
 *
 * Extraido de `SignupPage` para o cadastro e a tela "Meu negócio" usarem o mesmo
 * limite: duplicado, um dos dois acabaria enviando imagem que o outro recusa.
 */

/** Lado maior do logo, em pixels. Ele nunca aparece maior que 56px na interface. */
const DEFAULT_MAX_SIZE = 256

export async function toCompactDataUrl(file: File, maxSize = DEFAULT_MAX_SIZE): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
    reader.readAsDataURL(file)
  })

  const img = new Image()
  // Sem isto o canvas e marcado como "contaminado" e `toDataURL` lanca erro.
  img.crossOrigin = 'anonymous'
  img.src = dataUrl
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error('Arquivo de imagem inválido.'))
  })

  const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')
  // Sem contexto 2D (canvas desabilitado) devolvemos o original: o servidor
  // ainda valida o tamanho, entao o pior caso e uma mensagem de "imagem grande".
  if (!ctx) return dataUrl
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  // JPEG a 0.85 em vez de PNG: perde transparencia, mas o PNG pesa varias vezes
  // mais e a diferenca e invisivel no tamanho em que o logo aparece.
  return canvas.toDataURL('image/jpeg', 0.85)
}
