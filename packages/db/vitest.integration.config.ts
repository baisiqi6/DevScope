import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

// 真实 PostgreSQL 集成门禁：仅 *.integration.test.ts。
// globalSetup 负责隔离门禁（fail closed）与唯一测试库生命周期；
// 单进程串行（多个集成文件共享同一测试库）。
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.integration.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    globalSetup: [path.resolve(__dirname, "src/test-integration/global-setup.ts")],
    setupFiles: [path.resolve(__dirname, "src/test-integration/setup-file.ts")],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
  },
});
