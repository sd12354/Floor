import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Test against core's source so the api tests never run against a stale dist build.
    alias: { '@floor/core': path.resolve(here, '../../packages/core/src/index.ts') },
  },
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    env: { NODE_ENV: 'test', FLOOR_MODE: 'mock' },
  },
});
