import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@/raqb': path.resolve(__dirname, '../frontend/src/lib/raqb'),
    },
  },
  test: {
    include: ['worker/**/*.test.ts'],
  },
});
