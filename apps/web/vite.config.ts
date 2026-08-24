import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const host = process.env.TAURI_DEV_HOST || '127.0.0.1'
const backendUrl = process.env.RIN_WEB_SERVER_URL || 'http://127.0.0.1:8320'
const backendProxy = {
  target: backendUrl,
  changeOrigin: true,
  ws: true,
  headers: { origin: backendUrl },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host,
    hmr: { protocol: 'ws', host, port: 1421 },
    proxy: {
      '/health': backendProxy,
      '/api': backendProxy,
      '/ws': backendProxy,
    },
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
