import { randomBytes } from "node:crypto";

// ============================================================================
// 集成测试隔离门禁（Isolation Contract）
//
// 任何时候都不能连接开发库或生产库：
// - 只有显式的 TEST_DATABASE_URL 可启用 integration tests；
// - host/database allowlist、NODE_ENV=test 与 destructive sentinel 任一不满足即拒绝；
// - postgres 仅允许作为 admin 入口，真实测试目标必须是派生的 devscope_test_* 库；
// - 拒绝以结构化结果返回（不抛出），由调用方决定 skip 还是 fail closed。
// ============================================================================

const ALLOWED_ADMIN_DATABASES = new Set(["postgres"]);
const TEST_DATABASE_PREFIX = "devscope_test_";
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

export interface IntegrationGateInput {
  TEST_DATABASE_URL?: string;
  /** 破坏性哨兵：确认 runner 可以创建/删除自己的临时测试库 */
  TEST_DATABASE_DESTRUCTIVE?: string;
  NODE_ENV?: string;
}

export type IntegrationGate =
  | { status: "not-configured" }
  | { status: "rejected"; reasons: string[] }
  | {
      status: "ok";
      adminUrl: string;
      adminDatabase: string;
      testDatabaseName: string;
      /** 测试目标库的完整连接串（密码原样透传，不打印） */
      testDatabaseUrl: string;
    };

/** 生成唯一测试库名：devscope_test_<random>，长度受 PostgreSQL 63 字节限制约束。 */
export function deriveTestDatabaseName(): string {
  return `${TEST_DATABASE_PREFIX}${randomBytes(6).toString("hex")}`;
}

export function resolveIntegrationGate(input: IntegrationGateInput): IntegrationGate {
  if (!input.TEST_DATABASE_URL) {
    return { status: "not-configured" };
  }

  const reasons: string[] = [];
  if (input.TEST_DATABASE_DESTRUCTIVE !== "1") {
    reasons.push("TEST_DATABASE_DESTRUCTIVE=1 未设置：runner 需要创建/删除临时测试库的显式确认");
  }
  if (input.NODE_ENV !== "test") {
    reasons.push(`NODE_ENV=${input.NODE_ENV ?? "(未设置)"}：集成测试只允许在 NODE_ENV=test 下运行`);
  }

  let parsed: URL;
  try {
    parsed = new URL(input.TEST_DATABASE_URL);
  } catch {
    return {
      status: "rejected",
      reasons: [`TEST_DATABASE_URL 无法解析：${maskUrl(input.TEST_DATABASE_URL)}`],
    };
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    reasons.push("TEST_DATABASE_URL 必须使用 postgresql:// 或 postgres:// 协议");
    return { status: "rejected", reasons };
  }

  const host = parsed.hostname;
  if (!ALLOWED_HOSTS.has(host)) {
    reasons.push(`host ${host} 不在 allowlist（localhost/127.0.0.1/::1/postgres）内`);
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!database) {
    reasons.push("TEST_DATABASE_URL 缺少数据库名");
  } else if (!ALLOWED_ADMIN_DATABASES.has(database)) {
    reasons.push(
      `目标数据库 ${database} 不允许：TEST_DATABASE_URL 只能指向 admin 入口（postgres）；` +
      `测试库一律由 runner 唯一派生（${TEST_DATABASE_PREFIX}*），不接受显式复用，` +
      `防止并发冲突与 cleanup 违反只删自己创建库的契约`,
    );
  }

  if (reasons.length > 0) {
    return { status: "rejected", reasons };
  }

  // 测试库名一律唯一派生：不与任何显式目标复用，保证并发隔离与无残留
  const testDatabaseName = deriveTestDatabaseName();

  return {
    status: "ok",
    adminUrl: input.TEST_DATABASE_URL,
    adminDatabase: database,
    testDatabaseName,
    testDatabaseUrl: rebuildUrlWithDatabase(parsed, testDatabaseName),
  };
}

function rebuildUrlWithDatabase(parsed: URL, database: string): string {
  const clone = new URL(parsed.toString());
  clone.pathname = `/${database}`;
  return clone.toString();
}

/** 日志脱敏：去掉 userinfo 与 query，只保留协议/host/port/db。 */
export function maskUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "<unparseable-url>";
  }
}
