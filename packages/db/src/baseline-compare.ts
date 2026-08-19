import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Db } from "./index";
import {
  repositories,
  repositoryTechnologyStacks,
  technologyStacks,
  repoRelationships,
} from "./schema";
import { canonicalizeTechnologyStackPackages } from "./technology-stack-entities";

// ============================================================================
// Phase C：legacy 冻结基线快照与单向包含比较
//
// 进入 new_only 前（最后一次 dual-write rebuild 通过 shadow zero-diff 后），
// 持久化 legacy baseline：full-set 的 (githubRepositoryId, slug) 存在性 key +
// packages digest（不做 top-N 裁剪）。观察窗口比较为单向包含：
//   baseline key ⊆ new 全集（missing 才 fail，missing 的裁定 = 复核 SBOM 重采集
//   后更新快照 receipt，禁止手工 SQL）；
//   digest 只对 updatedAt 不晚于冻结时间的行要求一致（重采集豁免，记数不 fail）。
// 旧的双向 compare（读 is_reference）随 legacy writer 退役。
// ============================================================================

export interface BaselineReceipt {
  baselineKeys: number;
  frozenAt: Date;
}

function digestPackages(packages: unknown): string {
  const canonical = canonicalizeTechnologyStackPackages(packages as never);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * 从 legacy 栈边（evidence->>'resolvedBy' = 'tech-stack-catalog'）读取冻结形态，
 * 写入 baseline receipt 表（表不存在则创建——fresh 环境安全）。
 */
export async function snapshotLegacyTechnologyStackBaseline(
  db: Db,
  userId: number,
): Promise<BaselineReceipt> {
  await db.execute(sql`
    create table if not exists technology_stack_baseline_receipts (
      id serial primary key,
      user_id integer not null,
      github_repository_id text not null,
      slug text not null,
      packages_digest text not null,
      frozen_at timestamp not null,
      unique (user_id, github_repository_id, slug)
    )
  `);
  // 清除该用户旧快照（裁定更新路径也走这里）
  await db.execute(sql`
    delete from technology_stack_baseline_receipts where user_id = ${userId}
  `);

  const legacyRows = await db
    .select({
      githubRepositoryId: repositories.githubRepositoryId,
      targetFullName: sql<string>`(select r2.full_name from repositories r2
        where r2.id = ${repoRelationships.targetRepoId})`,
      evidence: repoRelationships.evidence,
    })
    .from(repoRelationships)
    .innerJoin(repositories, eq(repositories.id, repoRelationships.sourceRepoId))
    .where(and(
      eq(repoRelationships.userId, userId),
      eq(repoRelationships.edgeType, "dependency"),
      sql`${repoRelationships.evidence}->>'resolvedBy' = 'tech-stack-catalog'`,
    ));

  // slug 从 target fullName 推导（tech-stack/<slug>）——不读 is_reference
  const seen = new Set<string>();
  const frozenAt = new Date();
  for (const row of legacyRows) {
    if (!row.githubRepositoryId) continue;
    if (!row.targetFullName?.startsWith("tech-stack/")) continue;
    const slug = row.targetFullName.slice("tech-stack/".length);
    const key = `${row.githubRepositoryId}|${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const packages = (row.evidence as { packages?: unknown })?.packages ?? [];
    await db.execute(sql`
      insert into technology_stack_baseline_receipts
        (user_id, github_repository_id, slug, packages_digest, frozen_at)
      values (${userId}, ${row.githubRepositoryId}, ${slug}, ${digestPackages(packages)}, ${frozenAt})
      on conflict (user_id, github_repository_id, slug) do nothing
    `);
  }
  return { baselineKeys: seen.size, frozenAt };
}

export interface BaselineComparison {
  equal: boolean;
  baselineCount: number;
  missingInNew: string[];
  digestDriftTouched: number;
}

/**
 * 单向包含比较：baseline (githubRepositoryId, slug) ⊆ 新表当前全集。
 * digest 只约束 updatedAt <= 冻结时间的行（重采集豁免）。
 */
export async function compareBaselineToCurrent(
  db: Db,
  userId: number,
): Promise<BaselineComparison> {
  const receiptExists = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.technology_stack_baseline_receipts') is not null as exists`,
  );
  if (!receiptExists.rows?.[0]?.exists) {
    // 无快照（未进入 new_only 或全新环境）——视为空基线，恒通过
    return { equal: true, baselineCount: 0, missingInNew: [], digestDriftTouched: 0 };
  }
  const baseline = await db.execute<{
    github_repository_id: string;
    slug: string;
    packages_digest: string;
    frozen_at: Date;
  }>(sql`
    select github_repository_id, slug, packages_digest, frozen_at
    from technology_stack_baseline_receipts where user_id = ${userId}
  `);
  const rows = baseline.rows ?? [];
  if (rows.length === 0) {
    return { equal: true, baselineCount: 0, missingInNew: [], digestDriftTouched: 0 };
  }

  const current = await db
    .select({
      githubRepositoryId: repositories.githubRepositoryId,
      slug: technologyStacks.slug,
      packages: repositoryTechnologyStacks.packages,
      updatedAt: repositoryTechnologyStacks.updatedAt,
    })
    .from(repositoryTechnologyStacks)
    .innerJoin(technologyStacks, eq(technologyStacks.id, repositoryTechnologyStacks.technologyStackId))
    .innerJoin(repositories, eq(repositories.id, repositoryTechnologyStacks.repositoryId));

  const currentKeys = new Map(current.map((r) => [`${r.githubRepositoryId}|${r.slug}`, r]));
  const missingInNew: string[] = [];
  let digestDriftTouched = 0;
  for (const row of rows) {
    const key = `${row.github_repository_id}|${row.slug}`;
    const currentRow = currentKeys.get(key);
    if (!currentRow) {
      missingInNew.push(key);
      continue;
    }
    if (currentRow.updatedAt.getTime() <= new Date(row.frozen_at).getTime()) {
      if (digestPackages(currentRow.packages) !== row.packages_digest) {
        // 未被重采集触碰的行 digest 漂移 = 真漂移
        digestDriftTouched++;
      }
    }
  }
  return {
    equal: missingInNew.length === 0 && digestDriftTouched === 0,
    baselineCount: rows.length,
    missingInNew,
    digestDriftTouched,
  };
}
