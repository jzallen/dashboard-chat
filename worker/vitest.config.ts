import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@/raqb': path.resolve(__dirname, '../frontend/src/lib/raqb'),
    },
  },
  test: {
    include: ['**/*.test.ts'],
  },
});
