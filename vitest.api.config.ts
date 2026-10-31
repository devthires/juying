import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/api/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/api/setup.ts'],
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
