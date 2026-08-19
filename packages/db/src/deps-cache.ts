import type { Db } from "./index";
import { and, eq, sql } from "drizzle-orm";
import { packageRepoMappings, githubRepoNameCanonicalizations } from "./schema";

// ============================================================================
// 外呼解析状态与配置
// ============================================================================

export type ResolutionStatus = "resolved" | "not_found" | "error";
export type ExternalProvider = "deps.dev" | "github";

export interface ExternalResolutionSettings {
  /** deps.dev 单请求超时（毫秒） */
  depsTimeoutMs: number;
  /** GitHub canonicalization 单请求超时（毫秒） */
  githubTimeoutMs: number;
  /** deps.dev 并发上限（保守个位数） */
  depsConcurrency: number;
  /** GitHub canonicalization 并发上限 */
  githubConcurrency: number;
  /** 相邻外呼开始的最小间隔（毫秒），与并发独立生效 */
  pacingMs: number;
  /** 单次 graph attempt 的 deps.dev 请求预算 */
  depsRequestBudget: number;
  /** 单次 graph attempt 的 GitHub 请求预算（canonicalization + SBOM） */
  githubRequestBudget: number;
  depsResolvedTtlMs: number;
  depsNotFoundTtlMs: number;
  depsErrorRetryMs: number;
  canonResolvedTtlMs: number;
  canonNotFoundTtlMs: number;
  canonErrorRetryMs: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60_000;

export const DEFAULT_EXTERNAL_RESOLUTION_SETTINGS: ExternalResolutionSettings = {
  depsTimeoutMs: 15_000,
  githubTimeoutMs: 15_000,
  depsConcurrency: 4,
  githubConcurrency: 3,
  pacingMs: 100,
  // 日期化冷启动基线：约 6000 deps.dev miss + 3053 canonicalization + SBOM 请求。
  // 默认预算必须让冷启动在单次 attempt 内收敛并留 headroom。
  depsRequestBudget: 10_000,
  githubRequestBudget: 6_000,
  depsResolvedTtlMs: 30 * DAY_MS,
  depsNotFoundTtlMs: 7 * DAY_MS,
  depsErrorRetryMs: 15 * MINUTE_MS,
  canonResolvedTtlMs: 30 * DAY_MS,
  canonNotFoundTtlMs: 7 * DAY_MS,
  canonErrorRetryMs: 15 * MINUTE_MS,
};

interface NumberSpec {
  key: string;
  min: number;
  max: number;
  apply: (settings: ExternalResolutionSettings, value: number) => void;
}

const SETTING_SPECS: Array<NumberSpec> = [
  { key: "DEPS_DEV_TIMEOUT_MS", min: 1_000, max: 60_000, apply: (s, v) => { s.depsTimeoutMs = v; } },
  { key: "GITHUB_TIMEOUT_MS", min: 1_000, max: 60_000, apply: (s, v) => { s.githubTimeoutMs = v; } },
  { key: "GRAPH_DEPS_CONCURRENCY", min: 1, max: 8, apply: (s, v) => { s.depsConcurrency = v; } },
  { key: "GRAPH_GITHUB_CONCURRENCY", min: 1, max: 8, apply: (s, v) => { s.githubConcurrency = v; } },
  { key: "GRAPH_PACING_MS", min: 0, max: 5_000, apply: (s, v) => { s.pacingMs = v; } },
  { key: "GRAPH_DEPS_REQUEST_BUDGET", min: 100, max: 100_000, apply: (s, v) => { s.depsRequestBudget = v; } },
  { key: "GRAPH_GITHUB_REQUEST_BUDGET", min: 100, max: 100_000, apply: (s, v) => { s.githubRequestBudget = v; } },
  { key: "GRAPH_DEPS_RESOLVED_TTL_HOURS", min: 1, max: 8_760, apply: (s, v) => { s.depsResolvedTtlMs = v * HOUR_MS; } },
  { key: "GRAPH_DEPS_NOT_FOUND_TTL_HOURS", min: 1, max: 8_760, apply: (s, v) => { s.depsNotFoundTtlMs = v * HOUR_MS; } },
  { key: "GRAPH_DEPS_ERROR_RETRY_MINUTES", min: 1, max: 1_440, apply: (s, v) => { s.depsErrorRetryMs = v * MINUTE_MS; } },
  { key: "GRAPH_CANON_RESOLVED_TTL_HOURS", min: 1, max: 8_760, apply: (s, v) => { s.canonResolvedTtlMs = v * HOUR_MS; } },
  { key: "GRAPH_CANON_NOT_FOUND_TTL_HOURS", min: 1, max: 8_760, apply: (s, v) => { s.canonNotFoundTtlMs = v * HOUR_MS; } },
  { key: "GRAPH_CANON_ERROR_RETRY_MINUTES", min: 1, max: 1_440, apply: (s, v) => { s.canonErrorRetryMs = v * MINUTE_MS; } },
];

/**
 * 从环境变量解析外呼配置；任何非法值在启动/任务开始时 fail closed，
 * 错误信息包含具体变量名，解析语义不允许由环境变量切换。
 */
export function resolveExternalResolutionSettings(
  env: Record<string, string | undefined>,
): ExternalResolutionSettings {
  const settings = { ...DEFAULT_EXTERNAL_RESOLUTION_SETTINGS };
  for (const spec of SETTING_SPECS) {
    const raw = env[spec.key];
    if (raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < spec.min || value > spec.max) {
      throw new Error(
        `非法的外呼配置 ${spec.key}=${raw}：必须是 ${spec.min} 到 ${spec.max} 之间的整数`,
      );
    }
    spec.apply(settings, value);
  }
  return settings;
}

// ============================================================================
// 响应分类：deps.dev
// ============================================================================

export interface DepsDevOutcome {
  status: ResolutionStatus;
  /** resolved 时的 GitHub owner/repo；其他状态为 null */
  sourceRepo: string | null;
  /** 仅 429 响应携带的服务端 Retry-After 秒数 */
  retryAfterSeconds: number | null;
  /** error 状态的脱敏短错误摘要 */
  errorSummary: string | null;
}

interface DepsDevBody {
  relatedProjects?: unknown;
}

/**
 * 将 deps.dev 版本端点响应分类为 resolved / not_found / error。
 * 只有权威 404 或成功响应明确无 SOURCE_REPO 才能进入 not_found；
 * 429/5xx/malformed 一律是可重试 error，不得写成永久阴性。
 */
export function classifyDepsDevResponse(
  httpStatus: number,
  body: unknown,
  retryAfterHeaderSeconds: number | null,
): DepsDevOutcome {
  if (httpStatus === 429) {
    return { status: "error", sourceRepo: null, retryAfterSeconds: retryAfterHeaderSeconds ?? 60, errorSummary: "http_429" };
  }
  if (httpStatus === 404) {
    return { status: "not_found", sourceRepo: null, retryAfterSeconds: null, errorSummary: null };
  }
  if (httpStatus >= 500) {
    return { status: "error", sourceRepo: null, retryAfterSeconds: null, errorSummary: `http_${httpStatus}` };
  }
  if (httpStatus !== 200) {
    return { status: "error", sourceRepo: null, retryAfterSeconds: null, errorSummary: `http_${httpStatus}` };
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { status: "error", sourceRepo: null, retryAfterSeconds: null, errorSummary: "malformed_response" };
  }
  const parsed = body as DepsDevBody;
  if (parsed.relatedProjects === undefined || !Array.isArray(parsed.relatedProjects)) {
    return { status: "error", sourceRepo: null, retryAfterSeconds: null, errorSummary: "malformed_response" };
  }
  const sourceProject = parsed.relatedProjects.find(
    (p): p is { relationType: string; projectKey: { id: string } } =>
      typeof p === "object" && p !== null && (p as { relationType?: unknown }).relationType === "SOURCE_REPO",
  );
  const id = sourceProject?.projectKey?.id;
  if (typeof id !== "string" || !id.startsWith("github.com/")) {
    return { status: "not_found", sourceRepo: null, retryAfterSeconds: null, errorSummary: null };
  }
  const sourceRepo = id.slice("github.com/".length);
  if (!sourceRepo.includes("/")) {
    return { status: "error", sourceRepo: null, retryAfterSeconds: null, errorSummary: "malformed_response" };
  }
  return { status: "resolved", sourceRepo, retryAfterSeconds: null, errorSummary: null };
}

// ============================================================================
// 响应分类：GitHub canonicalization
// ============================================================================

export interface CanonicalizationOutcome {
  status: ResolutionStatus;
  /** resolved 时的规范 fullName；not_found/error 为 null（调用方保持原名） */
  canonicalFullName: string | null;
  retryAfterSeconds: number | null;
  errorSummary: string | null;
}

export function classifyCanonicalizationResponse(
  httpStatus: number,
  body: unknown,
  retryAfterHeaderSeconds: number | null,
): CanonicalizationOutcome {
  if (httpStatus === 429) {
    return { status: "error", canonicalFullName: null, retryAfterSeconds: retryAfterHeaderSeconds ?? 60, errorSummary: "http_429" };
  }
  if (httpStatus === 404) {
    return { status: "not_found", canonicalFullName: null, retryAfterSeconds: null, errorSummary: null };
  }
  if (httpStatus >= 500 || httpStatus !== 200) {
    return { status: "error", canonicalFullName: null, retryAfterSeconds: null, errorSummary: `http_${httpStatus}` };
  }
  const fullName = (body as { full_name?: unknown } | null)?.full_name;
  if (typeof fullName !== "string" || !fullName.includes("/")) {
    return { status: "error", canonicalFullName: null, retryAfterSeconds: null, errorSummary: "malformed_response" };
  }
  return { status: "resolved", canonicalFullName: fullName, retryAfterSeconds: null, errorSummary: null };
}

// ============================================================================
// 缓存行解释
// ============================================================================

export type CacheLookupKind = "hit" | "negative" | "pending" | "due";

export type MappingLookup =
  | { kind: "hit"; sourceRepo: string }
  | { kind: Exclude<CacheLookupKind, "hit"> };

export type CanonicalizationLookup =
  | { kind: "hit"; canonicalFullName: string }
  | { kind: Exclude<CacheLookupKind, "hit"> };

export interface MappingRowSnapshot {
  resolutionStatus: ResolutionStatus;
  sourceRepo: string | null;
  retryAfter: Date | null;
}

export interface CanonicalizationRowSnapshot {
  resolutionStatus: ResolutionStatus;
  canonicalFullName: string | null;
  retryAfter: Date | null;
}

function interpretRow(row: { resolutionStatus: ResolutionStatus; retryAfter: Date | null } | undefined, now: Date): CacheLookupKind {
  if (!row) return "due";
  const retryAfter = row.retryAfter ? row.retryAfter.getTime() : 0;
  if (now.getTime() < retryAfter) {
    if (row.resolutionStatus === "resolved") return "hit";
    if (row.resolutionStatus === "not_found") return "negative";
    return "pending";
  }
  return "due";
}

/** error 行的 lastResolvedRepo 只是证据，不影响解释：pending 期间按无映射参与本轮。 */
export function interpretMappingRow(row: MappingRowSnapshot | undefined, now: Date): MappingLookup {
  const kind = interpretRow(row, now);
  if (kind === "hit") return { kind, sourceRepo: row!.sourceRepo! };
  return { kind };
}

export function interpretCanonicalizationRow(
  row: CanonicalizationRowSnapshot | undefined,
  now: Date,
): CanonicalizationLookup {
  const kind = interpretRow(row, now);
  if (kind === "hit") return { kind, canonicalFullName: row!.canonicalFullName! };
  return { kind };
}

export function mappingRetryAt(status: ResolutionStatus, now: Date, settings: ExternalResolutionSettings): Date {
  if (status === "resolved") return new Date(now.getTime() + settings.depsResolvedTtlMs);
  if (status === "not_found") return new Date(now.getTime() + settings.depsNotFoundTtlMs);
  return new Date(now.getTime() + settings.depsErrorRetryMs);
}

export function canonicalizationRetryAt(status: ResolutionStatus, now: Date, settings: ExternalResolutionSettings): Date {
  if (status === "resolved") return new Date(now.getTime() + settings.canonResolvedTtlMs);
  if (status === "not_found") return new Date(now.getTime() + settings.canonNotFoundTtlMs);
  return new Date(now.getTime() + settings.canonErrorRetryMs);
}

// ============================================================================
// deps.dev 真实外呼（显式超时，网络等待永远在业务事务之外）
// ============================================================================

export function parseRetryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(Math.floor(seconds), 86_400);
}

function networkErrorOutcome(errorSummary: string): DepsDevOutcome {
  return { status: "error", sourceRepo: null, retryAfterSeconds: null, errorSummary };
}

export async function fetchDepsDevOutcome(
  system: string,
  packageName: string,
  packageVersion: string,
  settings: Pick<ExternalResolutionSettings, "depsTimeoutMs">,
  baseUrl = "https://api.deps.dev",
): Promise<DepsDevOutcome> {
  const encodedName = encodeURIComponent(packageName).replace(/%40/g, "@");
  const url = `${baseUrl}/v3/systems/${system}/packages/${encodedName}/versions/${encodeURIComponent(packageVersion)}`;

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(settings.depsTimeoutMs) });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return networkErrorOutcome("timeout");
    }
    return networkErrorOutcome("network_error");
  }
  const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
  if (!response.ok) {
    return classifyDepsDevResponse(response.status, null, retryAfterSeconds);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return networkErrorOutcome("timeout");
    }
    return networkErrorOutcome("malformed_response");
  }
  return classifyDepsDevResponse(response.status, body, retryAfterSeconds);
}

// ============================================================================
// 预算
// ============================================================================

export class GraphBudgetExceededError extends Error {
  constructor(
    public readonly provider: ExternalProvider,
    public readonly used: number,
    public readonly limit: number,
  ) {
    super(`外呼预算耗尽：${provider} 已使用 ${used}/${limit}，graph 在原子提交前 fail closed`);
    this.name = "GraphBudgetExceededError";
  }
}

export class GraphRateLimitedError extends Error {
  constructor(
    public readonly provider: ExternalProvider,
    public readonly retryAfterSeconds: number,
  ) {
    super(`外呼被限流：${provider} 返回 429，Retry-After ${retryAfterSeconds}s`);
    this.name = "GraphRateLimitedError";
  }
}

export class GraphLeaseLostError extends Error {
  constructor(reason: string) {
    super(`graph 任务租约已丢失：${reason}`);
    this.name = "GraphLeaseLostError";
  }
}

export class ExternalRequestBudget {
  private usedByProvider: Record<ExternalProvider, number> = { "deps.dev": 0, github: 0 };

  constructor(
    private readonly settings: Pick<ExternalResolutionSettings, "depsRequestBudget" | "githubRequestBudget">,
  ) {}

  private limitOf(provider: ExternalProvider): number {
    return provider === "deps.dev" ? this.settings.depsRequestBudget : this.settings.githubRequestBudget;
  }

  /** 预算内返回 true 并计数；耗尽抛 GraphBudgetExceededError（fail closed）。 */
  tryAcquire(provider: ExternalProvider): boolean {
    const used = this.usedByProvider[provider];
    const limit = this.limitOf(provider);
    if (used >= limit) {
      throw new GraphBudgetExceededError(provider, used, limit);
    }
    this.usedByProvider[provider] = used + 1;
    return true;
  }

  used(provider: ExternalProvider): number {
    return this.usedByProvider[provider];
  }

  remaining(provider: ExternalProvider): number {
    return this.limitOf(provider) - this.usedByProvider[provider];
  }

  snapshot(): { depsDev: { used: number; limit: number }; github: { used: number; limit: number } } {
    return {
      depsDev: { used: this.usedByProvider["deps.dev"], limit: this.settings.depsRequestBudget },
      github: { used: this.usedByProvider.github, limit: this.settings.githubRequestBudget },
    };
  }
}

// ============================================================================
// 有界并发池（带 pacing，错误停止调度、在飞任务可完成）
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBoundedPool<T>(
  items: readonly T[],
  opts: { concurrency: number; pacingMs: number },
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  let failure: { error: unknown } | null = null;
  let lastStartAt = 0;
  let startChain: Promise<void> = Promise.resolve();

  const workerLoop = async (): Promise<void> => {
    while (true) {
      if (failure) return;
      const index = nextIndex;
      nextIndex++;
      if (index >= items.length) return;

      // pacing 门：所有 worker 的任务开始时间通过同一条链间隔 pacingMs
      startChain = startChain.then(async () => {
        const wait = Math.max(0, lastStartAt + opts.pacingMs - Date.now());
        if (wait > 0) await sleep(wait);
        lastStartAt = Date.now();
      });
      await startChain;
      if (failure) return;

      try {
        await worker(items[index]);
      } catch (error) {
        if (!failure) failure = { error };
      }
    }
  };

  const workerCount = Math.max(1, Math.min(opts.concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));

  const captured = failure as { error: unknown } | null;
  if (captured) throw captured.error;
}

// ============================================================================
// 缓存读写 helpers
// ============================================================================

export interface PackageKey {
  system: string;
  packageName: string;
  packageVersion: string;
}

export function packageKeyId(key: PackageKey): string {
  return `${key.system}:${key.packageName}@${key.packageVersion}`;
}

/** 原子 upsert 一条 package→repo 映射；降级时旧值移动到 lastResolvedRepo。 */
export async function upsertMappingOutcome(
  db: Db,
  key: PackageKey,
  outcome: DepsDevOutcome,
  previousResolvedRepo: string | null,
  retryAt: Date,
): Promise<void> {
  const lastResolvedRepo =
    outcome.status === "error" ? (outcome.sourceRepo ?? previousResolvedRepo) : null;
  await db
    .insert(packageRepoMappings)
    .values({
      system: key.system,
      packageName: key.packageName,
      packageVersion: key.packageVersion,
      sourceRepo: outcome.status === "resolved" ? outcome.sourceRepo : null,
      resolutionStatus: outcome.status,
      retryAfter: retryAt,
      lastError: outcome.errorSummary,
      lastResolvedRepo,
    })
    .onConflictDoUpdate({
      target: [
        packageRepoMappings.system,
        packageRepoMappings.packageName,
        packageRepoMappings.packageVersion,
      ],
      set: {
        sourceRepo: outcome.status === "resolved" ? outcome.sourceRepo : null,
        resolutionStatus: outcome.status,
        retryAfter: retryAt,
        lastError: outcome.errorSummary,
        lastResolvedRepo,
        fetchedAt: new Date(),
      },
    });
}

export async function upsertCanonicalizationOutcome(
  db: Db,
  fullNameLower: string,
  outcome: CanonicalizationOutcome,
  retryAt: Date,
  previousCanonicalFullName: string | null = null,
): Promise<void> {
  // canonicalization 表不设 status⟺canonical 的 CHECK：error/not_found 降级时
  // 上一次的 canonical 值保留在 canonicalFullName 本身作为证据（与 deps.dev
  // 侧 last_resolved_repo 的"移动"语义对称）。
  const canonicalFullName =
    outcome.canonicalFullName ?? previousCanonicalFullName ?? null;
  await db
    .insert(githubRepoNameCanonicalizations)
    .values({
      fullName: fullNameLower,
      canonicalFullName,
      resolutionStatus: outcome.status,
      retryAfter: retryAt,
      lastError: outcome.errorSummary,
      checkedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: githubRepoNameCanonicalizations.fullName,
      set: {
        canonicalFullName,
        resolutionStatus: outcome.status,
        retryAfter: retryAt,
        lastError: outcome.errorSummary,
        checkedAt: new Date(),
      },
    });
}

/** canonical rename 批量回写：只改命名，不改 resolution 状态与证据。 */
export async function rewriteMappingsForRename(
  db: Db,
  fromFullNameLower: string,
  toFullName: string,
): Promise<void> {
  await db
    .update(packageRepoMappings)
    .set({ sourceRepo: toFullName })
    .where(
      and(
        eq(packageRepoMappings.resolutionStatus, "resolved"),
        sql`lower(${packageRepoMappings.sourceRepo}) = ${fromFullNameLower}`,
      ),
    );
}
