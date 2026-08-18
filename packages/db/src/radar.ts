/**
 * 技术雷达候选池操作。
 */

import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import {
  radarCandidates,
  repositories,
  userWatchedRepositories,
  type RadarCandidate,
} from "./schema";
import type { Db } from "./index";

export interface UpsertRadarCandidateInput {
  userId: number;
  githubRepoId?: string | null;
  fullName: string;
  name: string;
  owner: string;
  url?: string;
  description?: string | null;
  language?: string | null;
  stars?: number;
  forks?: number;
  openIssues?: number;
  source: string;
  evidence: Record<string, unknown>;
  deterministicScore?: number | null;
  scoreBreakdown?: Record<string, number> | null;
  observedAt?: Date;
}

export interface RadarInterestProfile {
  totalRepositories: number;
  languages: Record<string, number>;
}

/**
 * 按 `(userId, fullName)` 聚合重复发现信号，不改变用户已经做出的状态选择。
 */
export async function upsertRadarCandidate(
  db: Db,
  input: UpsertRadarCandidateInput
): Promise<RadarCandidate> {
  const fullName = normalizeFullName(input.fullName);
  const [owner, name] = fullName.split("/");
  const observedAt = input.observedAt ?? new Date();
  const values = {
    userId: input.userId,
    githubRepoId: input.githubRepoId ?? null,
    fullName,
    owner: input.owner.trim() || owner,
    name: input.name.trim() || name,
    url: input.url ?? `https://github.com/${fullName}`,
    description: input.description ?? null,
    language: input.language ?? null,
    stars: input.stars ?? 0,
    forks: input.forks ?? 0,
    openIssues: input.openIssues ?? 0,
    source: input.source,
    evidence: input.evidence,
    deterministicScore: input.deterministicScore ?? null,
    scoreBreakdown: input.scoreBreakdown ?? null,
    lastSeenAt: observedAt,
    updatedAt: observedAt,
  };

  const [candidate] = await db
    .insert(radarCandidates)
    .values({
      ...values,
      firstSeenAt: observedAt,
    })
    .onConflictDoUpdate({
      target: [radarCandidates.userId, radarCandidates.fullName],
      set: values,
    })
    .returning();

  if (!candidate) {
    throw new Error(`技术雷达候选写入失败: ${fullName}`);
  }

  return candidate;
}

/** 从当前用户已关注仓库中提取轻量语言偏好，不引入第二套画像数据。 */
export async function getRadarInterestProfile(
  db: Db,
  userId: number,
): Promise<RadarInterestProfile> {
  const rows = await db
    .select({
      language: repositories.language,
      count: sql<number>`count(*)::int`,
    })
    .from(userWatchedRepositories)
    .innerJoin(repositories, eq(repositories.id, userWatchedRepositories.repoId))
    .where(and(
      eq(userWatchedRepositories.userId, userId),
      eq(repositories.isReference, false),
      isNotNull(repositories.language),
    ))
    .groupBy(repositories.language);

  const languages: Record<string, number> = {};
  let totalRepositories = 0;
  for (const row of rows) {
    const count = Number(row.count);
    totalRepositories += count;
    if (row.language) {
      languages[row.language.toLowerCase()] = count;
    }
  }

  return { totalRepositories, languages };
}

/** 当前用户的发现榜候选；已 dismiss 的条目不再展示。 */
export async function listRadarCandidates(
  db: Db,
  userId: number,
  limit = 50,
): Promise<RadarCandidate[]> {
  return db
    .select()
    .from(radarCandidates)
    .where(and(
      sql`${radarCandidates.userId} = ${userId}`,
      ne(radarCandidates.status, "dismissed"),
    ))
    .orderBy(
      sql`${radarCandidates.deterministicScore} DESC NULLS LAST`,
      desc(radarCandidates.stars),
      desc(radarCandidates.lastSeenAt),
    )
    .limit(Math.max(1, Math.min(limit, 100)));
}

function normalizeFullName(fullName: string): string {
  const normalized = fullName.trim().toLowerCase();
  const parts = normalized.split("/");

  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error(`无效 GitHub 仓库全名: ${fullName}`);
  }

  return normalized;
}
