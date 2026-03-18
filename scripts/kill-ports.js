#!/usr/bin/env node

/**
 * 端口清理脚本
 *
 * 用于杀死占用指定端口的进程，方便开发时快速清理端口。
 *
 * 用法:
 *   node scripts/kill-ports.js          # 清理默认端口 (3000, 3100)
 *   node scripts/kill-ports.js 8080     # 清理指定端口
 *   node scripts/kill-orts.js 3000 3100 # 清理多个端口
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// 默认清理的端口
const DEFAULT_PORTS = [3000, 3100, 9997];

/**
 * Windows 平台杀死占用端口的进程
 */
function killPortWindows(port) {
  try {
    // 查找占用端口的进程
    const result = execSync(
      `netstat -ano | findstr :${port}`,
      { encoding: "utf-8" }
    );

    if (!result.trim()) {
      console.log(`✅ 端口 ${port} 未被占用`);
      return false;
    }

    // 提取 PID
    const lines = result.trim().split("\n");
    const pids = new Set();

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== "0") {
        pids.add(pid);
      }
    }

    // 杀死进程
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { encoding: "utf-8" });
        console.log(`🔪 已杀死端口 ${port} 上的进程 (PID: ${pid})`);
      } catch (err) {
        console.log(`⚠️  无法杀死进程 ${pid}: ${err.message}`);
      }
    }

    return true;
  } catch (err) {
    if (err.status === 1) {
      console.log(`✅ 端口 ${port} 未被占用`);
      return false;
    }
    throw err;
  }
}

/**
 * Unix/Linux/macOS 平台杀死占用端口的进程
 */
function killPortUnix(port) {
  try {
    // 使用 lsof 查找并杀死进程
    const result = execSync(
      `lsof -ti:${port} | xargs kill -9 2>/dev/null || true`,
      { encoding: "utf-8" }
    );

    if (!result.trim()) {
      console.log(`✅ 端口 ${port} 未被占用`);
      return false;
    }

    console.log(`🔪 已杀死端口 ${port} 上的进程`);
    return true;
  } catch (err) {
    // lsof 可能未安装，尝试使用 fuser
    try {
      execSync(`fuser -k ${port}/tcp 2>/dev/null || true`, {
        encoding: "utf-8",
      });
      console.log(`🔪 已杀死端口 ${port} 上的进程`);
      return true;
    } catch (err2) {
      console.log(`⚠️  无法清理端口 ${port}: ${err.message}`);
      return false;
    }
  }
}

/**
 * 主函数
 */
function main() {
  const args = process.argv.slice(2);
  const ports = args.length > 0
    ? args.map((arg) => parseInt(arg, 10))
    : DEFAULT_PORTS;

  console.log("\n🧹 清理端口开始...");
  console.log("=".repeat(40));

  const isWindows = process.platform === "win32";
  const killPort = isWindows ? killPortWindows : killPortUnix;

  let killedCount = 0;

  for (const port of ports) {
    if (isNaN(port)) {
      console.log(`⚠️  无效的端口号: ${port}`);
      continue;
    }

    console.log(`\n检查端口 ${port}...`);
    if (killPort(port)) {
      killedCount++;
    }
  }

  console.log("\n" + "=".repeat(40));
  if (killedCount === 0) {
    console.log("✨ 所有端口都未被占用");
  } else {
    console.log(`✨ 已清理 ${killedCount} 个端口`);
  }
  console.log();
}

main();
