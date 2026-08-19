import { createDb, closeDb } from "./index";
import {
  validateTechnologyStackCleanup,
  executeTechnologyStackCleanup,
} from "./technology-stack-cleanup";

// ============================================================================
// Phase C cleanup 的受控 CLI 入口（deploy workflow 显式 opt-in 调用）：
//   node packages/db/dist/cleanup-cli.mjs --validate   只读校验（preflight）
//   node packages/db/dist/cleanup-cli.mjs --execute    执行清理（维护窗口）
// mode 从环境读取并要求 new_only；userId 单用户平台固定 1（与 scheduler 一致）。
// ============================================================================

async function main() {
  const command = process.argv[2] ?? "--validate";
  const mode = process.env.TECHNOLOGY_STACK_STORAGE_MODE ?? "";
  const db = createDb();
  try {
    if (command === "--validate") {
      const v = await validateTechnologyStackCleanup(db, { mode, userId: 1 });
      console.log(JSON.stringify(v, null, 2));
      if (!v.ok) process.exit(1);
      return;
    }
    if (command === "--execute") {
      const receipt = await executeTechnologyStackCleanup(db, { mode, userId: 1 });
      console.log(JSON.stringify({
        counts: receipt.validation.counts,
        droppedColumn: receipt.droppedColumn,
      }, null, 2));
      return;
    }
    console.error("用法：cleanup-cli.mjs --validate | --execute");
    process.exit(2);
  } finally {
    await closeDb();
  }
}

main().catch((error) => {
  console.error("[cleanup]", error instanceof Error ? error.message : error);
  process.exit(1);
});
