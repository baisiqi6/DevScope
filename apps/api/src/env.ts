/**
 * @package @devscope/api
 * @description 在其他服务模块初始化前加载 API 环境变量。
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

function findFirstExisting(paths: string[]): string | undefined {
  return paths.find((candidate) => fs.existsSync(candidate));
}

const cwd = process.cwd();
const localEnvPath = findFirstExisting([
  path.resolve(cwd, '.env.local'),
  path.resolve(cwd, '../../.env.local'),
]);
const baseEnvPath = findFirstExisting([path.resolve(cwd, '.env'), path.resolve(cwd, '../../.env')]);

for (const envPath of [localEnvPath, baseEnvPath]) {
  if (envPath) {
    dotenv.config({ path: envPath, override: false });
  }
}

console.log(
  `[Env] Loaded: local=${localEnvPath ? 'Yes' : 'No'}, base=${baseEnvPath ? 'Yes' : 'No'}`
);
