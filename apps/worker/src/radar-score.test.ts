import { describe, expect, it } from "vitest";
import { scoreRadarCandidate } from "./radar-score";

const repository = {
  githubRepoId: "1",
  fullName: "owner/repo",
  name: "repo",
  owner: "owner",
  description: null,
  url: "https://github.com/owner/repo",
  stars: 10_000,
  forks: 1_000,
  openIssues: 5,
  language: "TypeScript",
  topics: [],
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-16T00:00:00.000Z"),
  pushedAt: new Date("2026-08-16T00:00:00.000Z"),
};

describe("DevScope 发现榜评分", () => {
  it("将热度、活跃度、语言偏好和社区信号拆分为可解释分数", () => {
    const result = scoreRadarCandidate(repository, {
      totalRepositories: 4,
      languages: { typescript: 3, rust: 1 },
    }, new Date("2026-08-17T00:00:00.000Z"));

    expect(result.breakdown).toEqual({
      popularity: 28,
      freshness: 25,
      languageAffinity: 19,
      community: 11,
    });
    expect(result.total).toBe(83);
  });

  it("没有兴趣画像时仍可依靠公开指标排序", () => {
    const result = scoreRadarCandidate(repository, {
      totalRepositories: 0,
      languages: {},
    }, new Date("2027-08-17T00:00:00.000Z"));

    expect(result.breakdown.languageAffinity).toBe(0);
    expect(result.breakdown.freshness).toBe(0);
    expect(result.total).toBe(39);
  });
});
