import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifestFilename: 'manifest.json',
      workbox: {
        globPatterns: ['**/*.{html,js,css,svg,png,woff2}'],
        // SPA fallback for client-side routes…
        navigateFallback: 'index.html',
        // …but NEVER hijack /api/* navigations: /api/v1/docs/* is the real
        // swagger-ui page (served by the Go backend behind auth). Without this
        // denylist the SW serves the Vue shell for the docs URL → blank page
        // on direct navigation (ctrl+F5 works only because hard reload
        // bypasses the service worker).
        navigateFallbackDenylist: [/^\/api\/.*/],
        runtimeCaching: [
          // API routes first (NetworkFirst): fresh data, cache as offline fallback.
          // Must be listed BEFORE the broad pattern below — otherwise this route
          // is dead code and /api responses fall into StaleWhileRevalidate.
          {
            urlPattern: /\/api\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60,
              },
            },
          },
          {
            urlPattern: /^https?:\/\/.*\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'pages-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 7 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
      manifest: {
        name: 'Linux Service Manager',
        short_name: 'LSM',
        description: 'Systemd 服務管理面板',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/logout': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/login': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../src/static',
    emptyOutDir: true,
  },
})
