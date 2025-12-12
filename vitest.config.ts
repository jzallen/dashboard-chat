import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // Cast needed due to vitest bundling its own vite with different types
  plugins: [react() as any],
  resolve: {
    alias: {
      '@/table-tools': path.resolve(__dirname, 'src/lib/table-tools'),
      '@/chat': path.resolve(__dirname, 'src/lib/chat'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
