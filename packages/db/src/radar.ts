/**
 * 技术雷达候选池操作。
 */

import { radarCandidates, type RadarCandidate } from "./schema";
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
  observedAt?: Date;
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

function normalizeFullName(fullName: string): string {
  const normalized = fullName.trim().toLowerCase();
  const parts = normalized.split("/");

  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new Error(`无效 GitHub 仓库全名: ${fullName}`);
  }

  return normalized;
}
