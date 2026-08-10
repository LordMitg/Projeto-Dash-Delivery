#!/usr/bin/env node
/**
 * Mostra o endereco de acesso pelo celular e um QR Code para abrir sem digitar.
 *
 * Por que existe: para usar o scanner no celular e preciso abrir o app pelo IP
 * do PC em HTTPS. Descobrir esse IP significava rodar `ipconfig`, achar o
 * "Endereco IPv4" no meio da saida, e digitar 15 caracteres na tela do celular
 * sem errar. Isso agora e uma linha no terminal e um QR.
 *
 * Roda junto do `pnpm dev:mobile`.
 */
import os from 'node:os'
import { execSync } from 'node:child_process'

const PORT = process.env.PORT ?? '3000'

/**
 * Este script e uma AJUDA, nunca um bloqueio.
 *
 * Ele roda antes do dev server em `pnpm dev:mobile`, encadeado com `&&`: se
 * terminasse com codigo de erro, o servidor nao subiria — um utilitario de
 * conveniencia teria impedido o trabalho. Qualquer falha aqui apenas avisa.
 */
process.on('uncaughtException', (err) => {
  console.log(`\n  (nao foi possivel detectar o IP: ${err.message})\n`)
  process.exit(0)
})

/** IPv4 nao interno das interfaces de rede, na ordem em que o SO lista. */
function lanAddresses() {
  const found = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      // `family` mudou de string para numero no Node 18; aceita os dois.
      const isV4 = addr.family === 'IPv4' || addr.family === 4
      if (!isV4 || addr.internal) continue
      found.push({ name, address: addr.address })
    }
  }
  return found
}

/**
 * Ordena preferindo a rede de casa/escritorio.
 *
 * Numa maquina com Docker ou WSL ha varias interfaces, e a primeira que o SO
 * devolve costuma ser uma ponte virtual (172.17.x.x) que o celular NAO alcanca.
 * Mostrar esse IP em primeiro lugar seria pior que nao mostrar nada: o QR abriria
 * uma pagina que nunca carrega, e a suspeita cairia sobre o certificado.
 */
/**
 * Interfaces virtuais: Docker, WSL, VirtualBox, VMware, VPN.
 *
 * Sao IPs privados validos, mas de redes que existem so dentro do PC — o celular
 * nunca chega neles. Ficavam listados como "tente esta outra rede", mandando
 * voce perseguir um endereco impossivel.
 */
const VIRTUAL_IFACE =
  /^(docker|br-|veth|virbr|vEthernet|VirtualBox|vmnet|vboxnet|tun|tap|utun|wg|ZeroTier|Hyper-V|WSL)/i

/** As faixas privadas da RFC 1918 — as que um celular na mesma rede alcanca. */
function isPrivateLan(ip) {
  if (ip.startsWith('192.168.') || ip.startsWith('10.')) return true
  const m = /^172\.(\d+)\./.exec(ip)
  return m ? Number(m[1]) >= 16 && Number(m[1]) <= 31 : false
}

function score({ name, address }) {
  let s = 0
  if (address.startsWith('192.168.')) s += 100 // rede domestica tipica
  else if (address.startsWith('10.')) s += 60
  else if (isPrivateLan(address)) s += 30 // 172.16-31: as vezes Docker/WSL
  // Fora da RFC 1918 (ex.: 100.64.x.x de CGNAT, VPN, sandbox). Nao e uma rede
  // que o celular alcanca, e o backend tambem nao libera no CORS.
  else s -= 50
  if (VIRTUAL_IFACE.test(name)) s -= 200
  if (/^(wl|wlan|Wi-Fi|wlp)/i.test(name)) s += 20 // celular esta no Wi-Fi
  return s
}

const candidates = lanAddresses().sort((a, b) => score(b) - score(a))
const reachable = candidates.filter(
  (c) => isPrivateLan(c.address) && !VIRTUAL_IFACE.test(c.name),
)

const line = '─'.repeat(58)
console.log(`\n┌${line}┐`)
console.log('│  SCANNER NO CELULAR');
console.log(`├${line}┤`)

if (candidates.length === 0) {
  console.log('│  Nenhuma rede local encontrada.')
  console.log('│  Conecte o PC ao Wi-Fi (o mesmo do celular) e rode de novo.')
  console.log(`└${line}┘\n`)
  process.exit(0)
}

// Nenhum IP de LAN privada: e o caso de VPN, CGNAT (100.64.x.x) ou de rodar
// dentro de um container. Imprimir o endereco como se fosse valido daria um QR
// que abre uma pagina eterna, e a culpa recairia sobre o certificado. Melhor
// dizer o que esta acontecendo.
if (reachable.length === 0) {
  console.log('│  Este PC nao tem IP de rede local (LAN).')
  console.log('│')
  console.log('│  Encontrado apenas:')
  for (const c of candidates.slice(0, 3)) {
    console.log(`│     ${c.address}  (${c.name})`)
  }
  console.log('│')
  console.log('│  Enderecos assim (VPN, CGNAT, container) nao sao alcancaveis')
  console.log('│  pelo celular. Conecte o PC ao mesmo Wi-Fi do aparelho — ou,')
  console.log('│  se estiver numa VPN, desligue-a e rode de novo.')
  console.log(`└${line}┘\n`)
  process.exit(0)
}

const primary = `https://${reachable[0].address}:${PORT}`

console.log('│  1. Conecte o celular no MESMO Wi-Fi do computador')
console.log('│  2. Abra este endereco no navegador do celular:')
console.log('│')
console.log(`│     ${primary}`)
console.log('│')
console.log('│  3. O aviso de "conexao nao privada" e esperado: o certificado')
console.log('│     e local, feito pelo mkcert. Toque em Avancado > Prosseguir.')

// Só as alcançáveis: sugerir um IP de VPN/container como alternativa mandaria
// você tentar um endereço que não pode funcionar.
if (reachable.length > 1) {
  console.log('│')
  console.log('│  Se nao abrir, tente uma das outras redes deste PC:')
  for (const c of reachable.slice(1, 4)) {
    console.log(`│     https://${c.address}:${PORT}  (${c.name})`)
  }
}

console.log(`└${line}┘`)

// O QR e uma conveniencia: se a lib nao estiver instalada, o endereco acima
// ainda resolve o problema, entao a falha aqui nunca derruba o `dev`.
try {
  const { default: qrcode } = await import('qrcode')
  const art = await qrcode.toString(primary, {
    type: 'terminal',
    small: true,
    errorCorrectionLevel: 'L',
  })
  console.log('\n  Ou aponte a camera do celular para este QR:\n')
  console.log(art)
} catch {
  console.log('\n  (QR indisponivel — use o endereco acima.)\n')
}

// Aviso sobre o mkcert: sem a CA instalada, o Android costuma recusar a conexao
// em vez de oferecer "prosseguir", e o sintoma parece ser "o site esta fora".
try {
  execSync('mkcert -CAROOT', { stdio: 'ignore' })
} catch {
  console.log(
    '  Dica: se o celular recusar a conexao sem oferecer "prosseguir",\n' +
      '  instale a CA local no PC com `mkcert -install` (uma vez so).\n',
  )
}
