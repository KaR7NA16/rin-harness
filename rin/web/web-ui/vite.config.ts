import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone development server for the rin web UI. In dev, /api is proxied
// to the @rin/web-server JSON API (default http://127.0.0.1:8320); the built
// dist/ is served by @rin/web-server in production.
//
// The public assets (brand icon, self-hosted fonts, provider icons) are the
// shared @rin/gui assets directory. Both the browser Web UI (8320) and the
// Tauri desktop shell embed this single frontend, so brand assets live in one
// place and are copied into dist/ at build time.
export default defineConfig({
  publicDir: '../../gui/gui/assets',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8320',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
})
