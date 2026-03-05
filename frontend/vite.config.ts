import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    watch: {
      usePolling: true,
    },
    hmr: {
      clientPort: 5173,
    },
    proxy: {
      '/api': {
        target: 'http://api:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://api:8000',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@/table-tools': path.resolve(__dirname, 'src/lib/table-tools'),
      '@/chat': path.resolve(__dirname, 'src/lib/chat'),
      '@/raqb': path.resolve(__dirname, 'src/lib/raqb'),
      '@/dataCatalog': path.resolve(__dirname, 'src/lib/dataCatalog'),
      '@/shared': path.resolve(__dirname, 'src/lib/shared'),
    },
  },
})
