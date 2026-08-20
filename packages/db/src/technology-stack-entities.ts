import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import { lockRepositoryIdentity, type CollectionTransaction } from "./collection";
import {
  repositories,
  repositoryTechnologyStacks,
  technologyStacks,
} from "./schema";

export const technologyStackStorageModeSchema = z.enum([
  "legacy_shadow_dual_write",
  "new_read_dual_write",
  "new_only",
  "legacy_cleaned",
]);
export type TechnologyStackStorageMode = z.infer<typeof technologyStackStorageModeSchema>;

export function parseTechnologyStackStorageMode(
  value: string | undefined,
): TechnologyStackStorageMode {
  return technologyStackStorageModeSchema.parse(value ?? "legacy_shadow_dual_write");
}

export function assertTechnologyStackStorageModeSupported(
  mode: TechnologyStackStorageMode,
  supported: readonly TechnologyStackStorageMode[],
): void {
  if (!supported.includes(mode)) {
    throw new Error(`当前 revision 不支持 TECHNOLOGY_STACK_STORAGE_MODE=${mode}`);
  }
}

/**
 * 本代码 revision 声明支持的存储模式（API/Worker 启动断言与 cleanup 前置
 * gate 的单一来源）。cleanup revision：维护窗口内 cleanup 前以 new_only
 * 运行，cleanup 脚本切 legacy_cleaned 后以同一 revision 重启；dual-write
 * 模式的兼容 revision 已随 new_only revision 退役，不再支持。
 */
export const TECHNOLOGY_STACK_SUPPORTED_MODES: readonly TechnologyStackStorageMode[] = [
  "new_only",
  "legacy_cleaned",
];

const technologyStackPackageSchema = z.object({
  system: z.string().trim().min(1),
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
}).strict();

export type TechnologyStackPackage = z.infer<typeof technologyStackPackageSchema>;

function packageKey(pkg: TechnologyStackPackage): string {
  return `${pkg.system}\u0000${pkg.name}\u0000${pkg.version}`;
}

export function canonicalizeTechnologyStackPackages(
  packages: TechnologyStackPackage[],
): TechnologyStackPackage[] {
  const byKey = new Map<string, TechnologyStackPackage>();
  for (const pkg of packages) {
    const parsed = technologyStackPackageSchema.parse(pkg);
    byKey.set(packageKey(parsed), parsed);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, pkg]) => pkg);
}

export interface RepositoryTechnologyStackInput {
  slug: string;
  name: string;
  url: string;
  description: string | null;
  packages: TechnologyStackPackage[];
}

export interface RepositoryTechnologyStackSnapshotInput {
  repositoryId: number;
  githubRepositoryId: string;
  expectedVersion: Date;
  expectedSbomPackages: unknown;
  relations: RepositoryTechnologyStackInput[];
}

export type RepositoryTechnologyStackApplyResult = "applied" | "stale";

function sbomBaselineMatches(expectedSbomPackages: unknown) {
  return expectedSbomPackages === null
    ? isNull(repositories.sbomPackages)
    : sql`${repositories.sbomPackages} IS NOT DISTINCT FROM ${JSON.stringify(expectedSbomPackages)}::jsonb`;
}

function collectionVersionMatches(expectedVersion: Date) {
  // PostgreSQL legacy/default timestamps may retain microseconds, while JavaScript Date and
  // the canonical collection token both use milliseconds. Compare at the token's precision.
  const expectedTimestamp = expectedVersion.toISOString().replace("T", " ").replace("Z", "");
  return sql`date_trunc('milliseconds', ${repositories.updatedAt}) = ${expectedTimestamp}::timestamp`;
}

async function replaceRepositoryTechnologyStacks(
  tx: CollectionTransaction,
  repositoryId: number,
  inputRelations: RepositoryTechnologyStackInput[],
  now: Date,
): Promise<void> {
  const stackIds = new Map<string, number>();
  const relations = [...inputRelations]
    .sort((left, right) => left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0);
  for (const relation of relations) {
    const [stack] = await tx
      .insert(technologyStacks)
      .values({
        slug: relation.slug,
        name: relation.name,
        url: relation.url,
        description: relation.description,
      })
      .onConflictDoUpdate({
        target: technologyStacks.slug,
        set: {
          name: relation.name,
          url: relation.url,
          description: relation.description,
          updatedAt: now,
        },
      })
      .returning({ id: technologyStacks.id });
    stackIds.set(relation.slug, stack.id);
  }

  await tx
    .delete(repositoryTechnologyStacks)
    .where(eq(repositoryTechnologyStacks.repositoryId, repositoryId));
  if (relations.length > 0) {
    await tx.insert(repositoryTechnologyStacks).values(relations.map((relation) => ({
      repositoryId,
      technologyStackId: stackIds.get(relation.slug)!,
      packages: canonicalizeTechnologyStackPackages(relation.packages),
      updatedAt: now,
    })));
  }
}

/**
 * 单个 source repository 是全局技术栈事实的唯一替换范围。
 * 网络与 catalog detection 必须在事务外完成；事务内只验证快照并整体替换。
 */
export async function applyRepositoryTechnologyStacksIfCurrent(
  db: Db,
  input: RepositoryTechnologyStackSnapshotInput,
): Promise<RepositoryTechnologyStackApplyResult> {
  return db.transaction(async (tx) => {
    return replaceRepositoryTechnologyStacksForCurrentSnapshots(tx, [input], new Date());
  });
}

/**
 * 在调用方事务内全序锁定并复核全部 source snapshot，再逐 source 替换新表事实。
 * 调用方可在同一事务继续写 legacy projection，从而保证 dual-write 只有一个 commit point。
 */
export async function replaceRepositoryTechnologyStacksForCurrentSnapshots(
  tx: CollectionTransaction,
  inputs: RepositoryTechnologyStackSnapshotInput[],
  now: Date,
): Promise<RepositoryTechnologyStackApplyResult> {
  const ordered = [...inputs].sort((left, right) =>
    left.githubRepositoryId.localeCompare(right.githubRepositoryId),
  );
  for (const input of ordered) {
    await lockRepositoryIdentity(tx, input.githubRepositoryId);
  }
  for (const input of ordered) {
    const [repository] = await tx
      .select({ id: repositories.id })
      .from(repositories)
      .where(and(
        eq(repositories.id, input.repositoryId),
        eq(repositories.githubRepositoryId, input.githubRepositoryId),
        collectionVersionMatches(input.expectedVersion),
        sbomBaselineMatches(input.expectedSbomPackages),
      ))
      .for("update");
    if (!repository) return "stale";
  }
  for (const input of ordered) {
    await replaceRepositoryTechnologyStacks(tx, input.repositoryId, input.relations, now);
  }
  return "applied";
}

export interface TechnologyStackProjectionRow {
  githubRepositoryId: string;
  slug: string;
  stackName: string;
  packages: TechnologyStackPackage[];
}

/**
 * 进程启动时的存储模式一致性检查（分层 fail closed）：
 * - cleaned marker：is_reference 列不存在 = 已 cleanup（唯一合法 mode 是 legacy_cleaned）；
 * - 列存在 + legacy_cleaned：仅当伪仓库计数为 0 时放行（cleanup 删除事务已提交
 *   但 DROP COLUMN 前崩溃的补删窗口，以及从未存在 legacy 表示的 fresh 重放库——
 *   implementation review P1-2 拍板：伪数据为 0 时不存在需要守护的冻结形态）；
 * - 任一双写/读模式下，新表必须存在（缺表 = 迁移未应用）；
 * - legacy 影子模式下 legacy 数据已被清（cleaned）时拒绝启动（回退窗口不存在）；
 * - new_read 模式下新表为空但 legacy 仍有技术栈 reference 时拒绝启动（未回填）。
 */
export async function assertStorageModeStartupConsistency(
  db: Db,
  mode: TechnologyStackStorageMode,
): Promise<void> {
  // Phase C marker：is_reference 列存在性 = 清理状态（列在 = 未清理）
  const marker = await db.execute<{ col_exists: boolean }>(sql`
    select exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'repositories'
        and column_name = 'is_reference'
    ) as col_exists
  `);
  const columnExists = !!marker.rows?.[0]?.col_exists;
  if (!columnExists) {
    if (mode === "legacy_cleaned") return;
    throw new Error(
      `is_reference 列已不存在（已 cleanup）但 mode=${mode}：列不存在时唯一合法 mode 是 legacy_cleaned`,
    );
  }
  const tables = await db.execute<{ stacks_exists: boolean; relations_exists: boolean }>(sql`
    select to_regclass('public.technology_stacks') is not null as stacks_exists,
           to_regclass('public.repository_technology_stacks') is not null as relations_exists
  `);
  const row = tables.rows?.[0];
  if (!row?.stacks_exists || !row?.relations_exists) {
    throw new Error(
      `TECHNOLOGY_STACK_STORAGE_MODE=${mode} 但技术栈新表缺失：迁移 0008 未应用，拒绝启动`,
    );
  }
  const counts = await db.execute<{ legacy_stack_refs: string; new_relations: string }>(sql`
    select
      (select count(*) from repositories
         where github_repository_id is null and full_name like 'tech-stack/%')::text as legacy_stack_refs,
      (select count(*) from repository_technology_stacks)::text as new_relations
  `);
  const c = counts.rows?.[0];
  const legacyCount = Number(c?.legacy_stack_refs ?? 0);
  const newCount = Number(c?.new_relations ?? 0);
  if (mode === "legacy_cleaned") {
    if (legacyCount > 0) {
      throw new Error(
        "mode=legacy_cleaned 但 is_reference 列与 legacy 伪数据仍存在（未执行 cleanup），拒绝启动",
      );
    }
    return;
  }
  if (mode === "legacy_shadow_dual_write" && legacyCount === 0 && newCount > 0) {
    throw new Error(
      "数据库技术栈 legacy 表示已被清空但 mode 仍为 legacy_shadow_dual_write（cleaned+legacy 组合），拒绝启动",
    );
  }
  if (mode === "new_read_dual_write" && newCount === 0 && legacyCount > 0) {
    throw new Error(
      "new_read_dual_write 但新表为空而 legacy 技术栈行存在（未回填），拒绝启动",
    );
  }
}

/**
 * top-N 技术栈选择语义的唯一实现：按使用仓库数降序、stack name 升序 tie-break。
 * shadow compare 与 new 读投影必须复用本函数，保证零差异时 UI 输出一致。
 */
export function selectTopTechnologyStackSlugs(
  rows: TechnologyStackProjectionRow[],
  topN: number,
): Set<string> {
  const usage = new Map<string, { name: string; sources: Set<string> }>();
  for (const row of rows) {
    const entry = usage.get(row.slug) ?? { name: row.stackName, sources: new Set<string>() };
    entry.sources.add(row.githubRepositoryId);
    usage.set(row.slug, entry);
  }
  return new Set([...usage.entries()]
    .sort(([, left], [, right]) =>
      right.sources.size - left.sources.size || left.name.localeCompare(right.name),
    )
    .slice(0, topN)
    .map(([slug]) => slug));
}
