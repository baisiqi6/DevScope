import {
  dropIntegrationDatabase,
  prepareIntegrationDatabase,
} from "./runner";
import { resolveIntegrationGate, maskUrl } from "./guard";

// vitest globalSetup（integration project 主进程，先于测试 worker fork）：
// - rejected 一律 fail closed；
// - not-configured 时：CI（INTEGRATION_REQUIRED=1）fail，本地允许跳过；
// - ok 时创建唯一测试库并应用全部迁移，把连接串写入 process.env.TEST_DATABASE_URL
//   （fork worker 继承主进程环境，与现有 integration 文件的读取方式兼容），
//   teardown 在 always 路径删除该库。

export default async function setup() {
  const gate = resolveIntegrationGate(process.env);

  if (gate.status === "rejected") {
    throw new Error(
      `集成测试隔离门禁拒绝运行：\n- ${gate.reasons.join("\n- ")}\n` +
      `（URL: ${maskUrl(process.env.TEST_DATABASE_URL ?? "")}）`,
    );
  }

  if (gate.status === "not-configured") {
    if (process.env.INTEGRATION_REQUIRED === "1") {
      throw new Error(
        "INTEGRATION_REQUIRED=1 但缺少 TEST_DATABASE_URL：CI 集成门禁必须真实运行，不允许静默跳过",
      );
    }
    console.log("[integration] 未配置 TEST_DATABASE_URL，跳过（本地可选门禁）");
    return;
  }

  const startedAt = Date.now();
  const prepared = await prepareIntegrationDatabase(gate);
  // 保留 admin 入口供矩阵用例派生额外测试库
  process.env.TEST_DATABASE_ADMIN_URL = gate.adminUrl;
  process.env.TEST_DATABASE_URL = prepared.url;
  console.log(
    `[integration] database=${prepared.name} migrations=0000..latest prepared in ${Date.now() - startedAt}ms`,
  );

  return async () => {
    const teardownStartedAt = Date.now();
    await dropIntegrationDatabase(gate, prepared.name);
    console.log(`[integration] database=${prepared.name} dropped in ${Date.now() - teardownStartedAt}ms`);
  };
}
