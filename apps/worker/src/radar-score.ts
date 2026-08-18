import type { GitHubSearchRepo, RadarInterestProfile } from "@devscope/db";

export interface RadarScore {
  total: number;
  breakdown: {
    popularity: number;
    freshness: number;
    languageAffinity: number;
    community: number;
  };
}

/**
 * 只使用可复算的 GitHub 指标和用户已关注仓库语言分布，避免黑盒推荐。
 * 四项贡献上限相加为 100，前端可以直接解释每一分的来源。
 */
export function scoreRadarCandidate(
  repository: GitHubSearchRepo,
  profile: RadarInterestProfile,
  now = new Date(),
): RadarScore {
  const popularity = logarithmicScore(repository.stars, 100_000, 35);
  const community = logarithmicScore(repository.forks, 10_000, 15);
  const freshness = freshnessScore(repository.pushedAt, now);
  const languageAffinity = languageScore(repository.language, profile);
  const breakdown = { popularity, freshness, languageAffinity, community };

  return {
    total: Object.values(breakdown).reduce((sum, value) => sum + value, 0),
    breakdown,
  };
}

function logarithmicScore(value: number, ceiling: number, maxScore: number): number {
  if (value <= 0) return 0;
  const normalized = Math.log10(value + 1) / Math.log10(ceiling + 1);
  return Math.round(Math.min(1, normalized) * maxScore);
}

function freshnessScore(pushedAt: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - pushedAt.getTime()) / 86_400_000);
  if (ageDays <= 7) return 25;
  if (ageDays <= 30) return 20;
  if (ageDays <= 90) return 14;
  if (ageDays <= 365) return 7;
  return 0;
}

function languageScore(
  language: string | null,
  profile: RadarInterestProfile,
): number {
  if (!language || profile.totalRepositories === 0) return 0;
  const count = profile.languages[language.toLowerCase()] ?? 0;
  if (count === 0) return 0;
  return Math.round((count / profile.totalRepositories) * 25);
}
