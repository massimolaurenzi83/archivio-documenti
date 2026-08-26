import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// `base` viene impostata da GitHub Actions (VITE_BASE=/nome-repo/) per il deploy su
// GitHub Pages. In locale resta '/'.
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg', 'icons/*.png'],
      workbox: {
        // I core WebAssembly di Tesseract sono grandi: vanno messi in cache
        // per garantire il funzionamento offline dell'OCR.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,wasm,gz}'],
        navigateFallbackDenylist: [/^\/tessdata/, /^\/tesseract/],
        // I font standard e le cMap di pdf.js (.pfb, .bcmap) restano fuori dal
        // precache di proposito: sono 2,3 MB che servono solo a chi apre un PDF,
        // e appesantirebbero l'installazione per tutti. Vengono però messi in
        // cache alla prima richiesta, così dalla seconda volta quel PDF si apre
        // anche senza rete. Senza questa regola l'anteprima di un PDF con font
        // non incorporati resterebbe a caricare per sempre offline.
        runtimeCaching: [
          {
            urlPattern: /\/pdf\/(standard_fonts|cmaps)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pdfjs-risorse',
              // 16 font più 169 cMap: il margine copre eventuali aggiunte.
              expiration: { maxEntries: 220, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Archivio Documenti',
        short_name: 'Archivio',
        description:
          'Caveau digitale personale per documenti e credenziali. Tutti i dati restano cifrati sul tuo dispositivo.',
        lang: 'it',
        dir: 'ltr',
        theme_color: '#0b0f1a',
        background_color: '#0b0f1a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
})
