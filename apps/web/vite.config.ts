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
  build: {
    rollupOptions: {
      output: {
        // 只拆确实进入首屏主 chunk 的基础依赖;其余保持动态 import 的自然分块,
        // 避免把按需加载的重型库合并成首屏巨块。
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('lucide-react')) return 'vendor-icons'
          if (id.includes('/react-dom/') || /\/react\//.test(id) || id.includes('scheduler') || id.includes('zustand')) return 'vendor-react'
          return undefined
        },
      },
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
