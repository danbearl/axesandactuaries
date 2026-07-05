import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // The types package's "exports" field points at compiled dist/ output,
      // which won't exist until `pnpm build` runs. Alias straight to source
      // so tests don't require a full workspace build first.
      '@axes-actuaries/types': fileURLToPath(new URL('../types/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 15000,
    // All test files share one Postgres database that gets truncated before
    // each test — running files in parallel would race on that truncation.
    fileParallelism: false,
  },
});
