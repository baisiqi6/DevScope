/**
 * 在数据库模块初始化前加载 Worker 环境变量。
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

function findFirstExisting(paths: string[]): string | undefined {
  return paths.find((candidate) => fs.existsSync(candidate));
}

const cwd = process.cwd();
const localEnvPath = findFirstExisting([
  path.resolve(cwd, ".env.local"),
  path.resolve(cwd, "../../.env.local"),
]);
const baseEnvPath = findFirstExisting([
  path.resolve(cwd, ".env"),
  path.resolve(cwd, "../../.env"),
]);

for (const envPath of [localEnvPath, baseEnvPath]) {
  if (envPath) {
    dotenv.config({ path: envPath, override: false });
  }
}

console.log(
  `[Worker Env] Loaded: local=${localEnvPath ? "Yes" : "No"}, base=${baseEnvPath ? "Yes" : "No"}`
);
