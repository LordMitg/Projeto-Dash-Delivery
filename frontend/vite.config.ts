import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Porta da API. O backend sobe em 3001 por padrao.
 */
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3001'

/**
 * HTTPS local e OPCIONAL e desligado por padrao.
 *
 * Por que opcional: a camera do celular (`getUserMedia`) so funciona em
 * contexto seguro, e `http://192.168.x.x` nao e contexto seguro — logo, para
 * usar o scanner pelo celular na rede local, e preciso HTTPS. Mas o mkcert
 * gera/instala uma CA na maquina, o que quebra em ambientes de CI e sandbox.
 *
 * Ative com:  VITE_HTTPS=true pnpm dev
 */
const useHttps = process.env.VITE_HTTPS === 'true'

export default defineConfig(async () => {
  const plugins: PluginOption[] = [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // O scanner e instalavel na tela inicial do celular.
      manifest: {
        name: 'Delivery ERP — PDV e Scanner',
        short_name: 'Delivery ERP',
        description:
          'PDV, cardapio, kanban de pedidos e scanner de codigo de barras.',
        lang: 'pt-BR',
        start_url: '/',
        display: 'standalone',
        // Vinho da identidade, igual ao `theme-color` do index.html: com o navy
        // antigo a tela de abertura do app instalado piscava azul antes de
        // carregar a interface, que e vinho.
        background_color: '#3e0f27',
        theme_color: '#3e0f27',
        // Gerados por `python3 scripts/generate-icons.py`.
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          // Arquivo PROPRIO para maskable, nao o icon-512 de novo. O Android
          // recorta o icone maskable num circulo: reaproveitar o icone comum
          // (que ja tem cantos arredondados e transparentes) resultava em borda
          // cortada e desenho encostando no limite do recorte. Este e
          // full-bleed e tem o desenho encolhido para dentro da zona segura.
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // A API nunca e servida do cache: estoque e pedidos precisam ser
        // sempre a verdade do servidor, senao o PDV vende o que nao existe.
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      devOptions: { enabled: false },
    }),
  ]

  // Carregado dinamicamente para que a ausencia do mkcert nao derrube o build.
  if (useHttps) {
    const { default: mkcert } = await import('vite-plugin-mkcert')
    plugins.push(mkcert())
  }

  return {
    plugins,
    resolve: {
      /**
       * TypeScript ANTES de JavaScript.
       *
       * O padrao do Vite e ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx']: com
       * '.js' na frente, um `App.js` esquecido ao lado de `App.tsx` era o que o
       * import sem extensao carregava. O build continuava verde e as alteracoes
       * no .tsx simplesmente nao apareciam — o tipo de falha que custa horas
       * porque nada acusa. Aqui o fonte sempre ganha do artefato.
       */
      extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
    },
    optimizeDeps: {
      /**
       * Dependencias que SO aparecem dentro de `import()` dinamico.
       *
       * O scanner do Vite percorre os imports estaticos a partir do entry para
       * decidir o que pre-empacotar. `recharts` e `barcode-detector` escapam
       * dessa varredura: o unico arquivo que usa recharts (DashboardCharts) e
       * carregado por `lazy(() => import(...))`, e o ponyfill do scanner entra
       * por `await import(...)` so quando a camera abre.
       *
       * O efeito era uma falha de corrida na primeira visita ao dashboard: o
       * Vite descobria o recharts tarde, re-otimizava as dependencias e trocava
       * o hash da pasta `.vite/deps` (`?v=3b8a1970` virava `?v=fbbd1c92`). O
       * modulo que ja estava sendo baixado apontava para o hash velho e batia
       * num arquivo que tinha acabado de deixar de existir — o log do servidor
       * dizia "The file does not exist at .../deps/recharts.js", e no navegador
       * isso chegava como "Failed to fetch dynamically imported module" e um
       * SyntaxError ao tentar interpretar a resposta como JavaScript.
       *
       * Declarando as duas aqui elas entram na PRIMEIRA passada e o hash nao
       * muda no meio da navegacao.
       */
      include: ['recharts', 'barcode-detector/ponyfill'],
    },
    server: {
      // 3000 e a porta que o preview procura. `strictPort` evita o Vite pular
      // para 5174/5175 quando a 3000 esta ocupada: se pular, o preview aponta
      // para uma porta morta e mostra tela branca.
      port: Number(process.env.PORT ?? 3000),
      strictPort: true,
      // `host: true` expoe na LAN para o celular acessar pelo IP do PC.
      host: true,
      /**
       * Dominios autorizados a falar com o dev server.
       *
       * O Vite 6+ recusa requisicoes com `Host` desconhecido (protecao contra
       * DNS rebinding) devolvendo 403 com um texto em vez do arquivo pedido.
       * Isso derrubava o preview do v0 por completo: comprovado com
       * `curl -H "Host: abc-3000.vusercontent.net"`, TODAS as respostas viravam
       * "Blocked request. This host is not allowed." — inclusive `/src/main.tsx`.
       * O navegador recebia esse texto no lugar do JavaScript e quebrava com um
       * SyntaxError, que era o erro visivel na tela.
       *
       * O `.` inicial autoriza o dominio e seus subdominios. `localhost` e
       * enderecos IP passam sem checagem no proprio Vite, entao o acesso local e
       * pelo IP da LAN (celular) continuam funcionando sem estar nesta lista.
       * Preferi enumerar os dominios em vez de `allowedHosts: true` para nao
       * abrir o servidor a qualquer site: com `host: true` ele escuta na rede.
       */
      allowedHosts: [
        '.vusercontent.net', // preview do v0
        '.v0.dev',
        '.v0.app',
        '.vercel.app', // deploys de preview
        // Tuneis usados para testar no celular fora da LAN (opcional).
        ...(process.env.VITE_ALLOWED_HOSTS?.split(',')
          .map((host) => host.trim())
          .filter(Boolean) ?? []),
      ],
      proxy: {
        // Sem este proxy, `/api/...` bateria no Vite e devolveria 404 —
        // era a causa do login falhar mesmo com o backend no ar.
        '/api': { target: API_TARGET, changeOrigin: true },
        // As fotos de produto sao servidas do disco do backend. Sem este proxy,
        // `<img src="/uploads/...">` bateria no Vite e a imagem nao carregaria em
        // desenvolvimento. Com ele, o MESMO caminho relativo gravado no banco
        // funciona em dev e em producao, sem host fixo dentro do dado.
        '/uploads': { target: API_TARGET, changeOrigin: true },
        '/socket.io': { target: API_TARGET, ws: true, changeOrigin: true },
      },
    },
    preview: { port: Number(process.env.PORT ?? 3000), host: true },
    build: { outDir: 'dist', sourcemap: true },
  }
})
