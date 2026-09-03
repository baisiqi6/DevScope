import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const dbIntegration = path.resolve(here, '../../packages/db/src/test-integration');

/** Isolated PostgreSQL integration gate for worker handlers. */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    globalSetup: [path.join(dbIntegration, 'global-setup.ts')],
    setupFiles: [path.join(dbIntegration, 'setup-file.ts')],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
  },
});
