/**
 * DevScope 后台 Worker 入口。
 */

import "./env";
import { hostname } from "node:os";
import { closeDb, createDb } from "@devscope/db";
import { runWorker } from "./worker";

const db = createDb();
const workerId = process.env.WORKER_ID || `${hostname()}:${process.pid}`;
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[Worker] 收到 ${signal}，将在当前任务结束后退出`);
    stopping = true;
  });
}

try {
  console.log(`[Worker] 启动 ${workerId}`);
  await runWorker(
    db,
    {
      workerId,
      pollIntervalMs: readPositiveInteger("WORKER_POLL_INTERVAL_MS", 5_000),
      leaseDurationMs: readPositiveInteger("WORKER_LEASE_DURATION_MS", 5 * 60_000),
      recoveryIntervalMs: readPositiveInteger("WORKER_RECOVERY_INTERVAL_MS", 60_000),
      retryDelayMs: readPositiveInteger("WORKER_RETRY_DELAY_MS", 60_000),
    },
    () => stopping
  );
} catch (error) {
  console.error("[Worker] 运行失败:", error);
  process.exitCode = 1;
} finally {
  await closeDb();
  console.log("[Worker] 已退出");
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
