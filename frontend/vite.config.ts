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
        background_color: '#0b1120',
        theme_color: '#0b1120',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-512.png',
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
    server: {
      // 3000 e a porta que o preview procura. `strictPort` evita o Vite pular
      // para 5174/5175 quando a 3000 esta ocupada: se pular, o preview aponta
      // para uma porta morta e mostra tela branca.
      port: Number(process.env.PORT ?? 3000),
      strictPort: true,
      // `host: true` expoe na LAN para o celular acessar pelo IP do PC.
      host: true,
      proxy: {
        // Sem este proxy, `/api/...` bateria no Vite e devolveria 404 —
        // era a causa do login falhar mesmo com o backend no ar.
        '/api': { target: API_TARGET, changeOrigin: true },
        '/socket.io': { target: API_TARGET, ws: true, changeOrigin: true },
      },
    },
    preview: { port: Number(process.env.PORT ?? 3000), host: true },
    build: { outDir: 'dist', sourcemap: true },
  }
})
