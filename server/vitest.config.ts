import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Integration tests share one PostgreSQL database. Running files in
    // parallel would let them interleave writes and see each other's rows,
    // so they run sequentially — correctness over speed for a suite this size.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/db/seed.ts', 'src/db/cli.ts', 'src/server.ts', 'src/types/**'],
    },
  },
});
