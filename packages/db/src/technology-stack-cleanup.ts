import { sql } from "drizzle-orm";
import type { Db } from "./index";
import { compareBaselineToCurrent } from "./baseline-compare";

// ============================================================================
// Phase C：技术栈 legacy 数据清理（独立 opt-in 脚本，非 journal 迁移）
//
// 权限边界：本脚本只由 deploy workflow 的显式 opt-in 输入调用；
// 常规 deploy / db:migrate 结构上不会触达（journal 中的 DROP COLUMN
// 被 cleanup receipt 守卫为 no-op）。执行前置校验全部通过才进入
// 单事务删除；任何 gate 失败在破坏性操作前退出。
// ============================================================================

export interface CleanupValidationInput {
  /** 调用方显式确认的目标 mode：仅 new_only 可进入 cleanup */
  mode: string;
  userId: number;
  /** 单用户平台：排空检查覆盖全部 active job */
}

export interface CleanupValidation {
  ok: boolean;
  reasons: string[];
  pseudoRepositoryIds: number[];
  counts: {
    legacyStackEdges: number;
    pseudoWatched: number;
    pseudoRepositories: number;
    realRepositories: number;
    realWatched: number;
    repoToRepoEdges: number;
  };
}

const PSEUDO_PREDICATE = sql`github_repository_id is null and full_name like 'tech-stack/%'`;

/** 只读前置校验：mode、任务排空、FK 断言清单、基线单向包含、删除集合计算。 */
export async function validateTechnologyStackCleanup(
  db: Db,
  input: CleanupValidationInput,
): Promise<CleanupValidation> {
  const reasons: string[] = [];

  if (input.mode !== "new_only") {
    reasons.push(`mode=${input.mode}：cleanup 只允许在 new_only 下执行`);
  }

  const activeJobs = await db.execute<{ n: string }>(sql`
    select count(*)::text as n from jobs
    where status in ('queued', 'running', 'retry_wait')
  `);
  if (Number(activeJobs.rows?.[0]?.n ?? 0) > 0) {
    reasons.push(`存在 ${activeJobs.rows![0].n} 个 active job：需先排空`);
  }

  const baseline = await compareBaselineToCurrent(db, input.userId);
  if (!baseline.equal) {
    reasons.push(
      `冻结基线单向包含失败：missingInNew=${JSON.stringify(baseline.missingInNew)} digestDrift=${baseline.digestDriftTouched}`,
    );
  }

  const pseudo = await db.execute<{ id: number }>(sql`
    select id from repositories where ${PSEUDO_PREDICATE}
  `);
  const pseudoIds = (pseudo.rows ?? []).map((r) => r.id);
  if (pseudoIds.length === 0) {
    reasons.push("未发现伪仓库集合（可能已清理过）");
  }

  // FK 断言清单：对伪仓库的引用必须显式为 0（不依赖 FK 碰巧拒绝或 cascade）
  if (pseudoIds.length > 0) {
    const idList = sql.raw(`array[${pseudoIds.join(",")}]`);
    const refs = await db.execute<{ chunks: string; hn: string; releases: string; groups: string; rts: string }>(sql`
      select
        (select count(*) from repo_chunks where repo_id = any(${idList}))::text as chunks,
        (select count(*) from hackernews_items where repo_id = any(${idList}))::text as hn,
        (select count(*) from releases where repo_id = any(${idList}))::text as releases,
        (select count(*) from group_members where repo_id = any(${idList}))::text as groups,
        (select count(*) from repository_technology_stacks where repository_id = any(${idList}))::text as rts
    `);
    const r = refs.rows?.[0];
    if (Number(r?.chunks ?? 0) > 0) reasons.push(`repo_chunks 引用伪仓库 ${r!.chunks} 行`);
    if (Number(r?.hn ?? 0) > 0) reasons.push(`hackernews_items 引用伪仓库 ${r!.hn} 行`);
    if (Number(r?.releases ?? 0) > 0) reasons.push(`releases 引用伪仓库 ${r!.releases} 行`);
    if (Number(r?.groups ?? 0) > 0) reasons.push(`group_members 引用伪仓库 ${r!.groups} 行（cascade 必须显式拦截）`);
    if (Number(r?.rts ?? 0) > 0) reasons.push(`repository_technology_stacks 引用伪仓库 ${r!.rts} 行`);
  }

  // 一一映射校验：每条 legacy 栈边的 (source githubRepositoryId, slug) 必须在新表
  const legacyEdges = await db.execute<{ gid: string; slug: string }>(sql`
    select src.github_repository_id as gid,
           replace(t.full_name, 'tech-stack/', '') as slug
    from repo_relationships e
    join repositories src on src.id = e.source_repo_id
    join repositories t on t.id = e.target_repo_id
    where e.edge_type = 'dependency'
      and e.evidence->>'resolvedBy' = 'tech-stack-catalog'
      and t.full_name like 'tech-stack/%'
  `);
  const edgeRows = legacyEdges.rows ?? [];
  if (edgeRows.length > 0) {
    const mapped = await db.execute<{ n: string }>(sql`
      with wanted(gid, slug) as (
        values ${sql.join(
          edgeRows.map((r) => sql`(${r.gid}::text, ${r.slug}::text)`),
          sql`, `,
        )}
      )
      select (select count(*) from wanted w
        where exists (
          select 1 from repository_technology_stacks rts
          join technology_stacks ts on ts.id = rts.technology_stack_id
          join repositories r on r.id = rts.repository_id
          where r.github_repository_id = w.gid and ts.slug = w.slug
        ))::text as n
    `);
    const mappedCount = Number(mapped.rows?.[0]?.n ?? 0);
    if (mappedCount !== edgeRows.length) {
      reasons.push(`一一映射校验失败：${edgeRows.length} 条 legacy 栈边仅 ${mappedCount} 条在新表可映射`);
    }
  }

  const countsRows = await db.execute<{
    legacy_edges: string; pseudo_watched: string; pseudo_repos: string;
    real_repos: string; real_watched: string; repo_edges: string;
  }>(sql`
    select
      (select count(*) from repo_relationships e join repositories t on t.id = e.target_repo_id
        where e.edge_type='dependency' and e.evidence->>'resolvedBy'='tech-stack-catalog')::text as legacy_edges,
      (select count(*) from user_watched_repositories w join repositories r on r.id = w.repo_id
        where ${PSEUDO_PREDICATE})::text as pseudo_watched,
      (select count(*) from repositories where ${PSEUDO_PREDICATE})::text as pseudo_repos,
      (select count(*) from repositories where github_repository_id is not null)::text as real_repos,
      (select count(*) from user_watched_repositories w join repositories r on r.id = w.repo_id
        where r.github_repository_id is not null)::text as real_watched,
      (select count(*) from repo_relationships e join repositories t on t.id = e.target_repo_id
        where e.edge_type='dependency' and coalesce(e.evidence->>'resolvedBy','') <> 'tech-stack-catalog'
          and t.github_repository_id is not null)::text as repo_edges
  `);
  const c = countsRows.rows?.[0];

  return {
    ok: reasons.length === 0,
    reasons,
    pseudoRepositoryIds: pseudoIds,
    counts: {
      legacyStackEdges: Number(c?.legacy_edges ?? 0),
      pseudoWatched: Number(c?.pseudo_watched ?? 0),
      pseudoRepositories: Number(c?.pseudo_repos ?? 0),
      realRepositories: Number(c?.real_repos ?? 0),
      realWatched: Number(c?.real_watched ?? 0),
      repoToRepoEdges: Number(c?.repo_edges ?? 0),
    },
  };
}

export interface CleanupReceipt {
  validation: CleanupValidation;
  droppedColumn: boolean;
}

/**
 * 执行 cleanup：前置校验通过后单事务删除 legacy 栈边 → 伪 watched → 伪 repositories，
 * 写 cleanup receipt，再执行 receipt 守卫的 DROP COLUMN is_reference。
 * 任何失败整体回滚，不留半清理状态。
 */
export async function executeTechnologyStackCleanup(
  db: Db,
  input: CleanupValidationInput,
): Promise<CleanupReceipt> {
  const validation = await validateTechnologyStackCleanup(db, input);
  if (!validation.ok) {
    throw new Error(`cleanup 前置校验失败：\n- ${validation.reasons.join("\n- ")}`);
  }

  await db.transaction(async (tx) => {
    // 顺序服从外键：边 → watched → repositories
    await tx.execute(sql`
      delete from repo_relationships e
      using repositories t
      where e.target_repo_id = t.id
        and e.edge_type = 'dependency'
        and e.evidence->>'resolvedBy' = 'tech-stack-catalog'
        and ${PSEUDO_PREDICATE}
    `);
    await tx.execute(sql`
      delete from user_watched_repositories w
      using repositories r
      where w.repo_id = r.id and ${PSEUDO_PREDICATE}
    `);
    await tx.execute(sql`
      delete from repositories where ${PSEUDO_PREDICATE}
    `);
    // receipt：journal 中的 DO block 依赖此表此行执行 DROP COLUMN
    await tx.execute(sql`
      create table if not exists technology_stack_cleanup_receipts (
        id serial primary key,
        executed_at timestamp not null,
        legacy_stack_edges integer not null,
        pseudo_watched integer not null,
        pseudo_repositories integer not null
      )
    `);
    await tx.execute(sql`
      insert into technology_stack_cleanup_receipts
        (executed_at, legacy_stack_edges, pseudo_watched, pseudo_repositories)
      values (now(), ${validation.counts.legacyStackEdges},
              ${validation.counts.pseudoWatched}, ${validation.counts.pseudoRepositories})
    `);
  });

  // DROP COLUMN 在事务后执行（DDL 需独立锁窗口；receipt 已持久化）
  await db.execute(sql`
    alter table repositories drop column if exists is_reference
  `);

  return { validation, droppedColumn: true };
}
