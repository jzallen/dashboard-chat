import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      '@/table-tools': path.resolve(__dirname, 'src/lib/table-tools'),
      '@/chat': path.resolve(__dirname, 'src/lib/chat'),
      '@/raqb': path.resolve(__dirname, 'src/lib/raqb'),
      '@/api': path.resolve(__dirname, 'src/lib/api'),
    },
  },
})
