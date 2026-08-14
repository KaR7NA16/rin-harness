import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone development server for the rin web UI. In dev, /api is proxied
// to the @rin/web-server JSON API (default http://127.0.0.1:8320); the built
// dist/ is served by @rin/web-server in production.
export default defineConfig({
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
  },
})
