import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Cast needed due to vitest bundling its own vite with different types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest bundles its own vite with different types
  plugins: [react() as any],
  resolve: {
    alias: {
      '@/table-tools': path.resolve(__dirname, 'src/lib/table-tools'),
      '@/chat': path.resolve(__dirname, 'src/lib/chat'),
      '@/raqb': path.resolve(__dirname, 'src/lib/raqb'),
      '@/dataCatalog': path.resolve(__dirname, 'src/lib/dataCatalog'),
      '@/shared': path.resolve(__dirname, 'src/lib/shared'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
