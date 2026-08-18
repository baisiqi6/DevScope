import { describe, expect, it, vi } from "vitest";
import {
  buildGitHubTrendingFallbackUrl,
  buildGitHubTrendingUrl,
  fetchGitHubTrending,
  parseGitHubTrendingFallbackJson,
  parseGitHubTrendingHtml,
} from "./github-trending";

const TRENDING_HTML = `
  <main data-hpc>
    <article class="Box-row">
      <h2><a href="/openai/codex"> openai / codex </a></h2>
      <p class="col-9">A &amp; B developer agent</p>
      <span itemprop="programmingLanguage">TypeScript</span>
      <a href="/openai/codex/stargazers">12,345</a>
      <a href="/openai/codex/forks">1.2k</a>
      <span class="float-sm-right">456 stars today</span>
    </article>
    <article class="Box-row">
      <h2><a href="https://github.com/vuejs/core">vuejs / core</a></h2>
      <a href="/vuejs/core/stargazers">50,001</a>
      <a href="/vuejs/core/forks">9,876</a>
      <span>1.5k stars this week</span>
    </article>
  </main>
`;

const FALLBACK_JSON = {
  title: "GitHub All Languages Daily Trending",
  description: "Daily Trending of All Languages in GitHub",
  link: "https://github.com/trending?since=daily",
  pubDate: "Tue, 18 Aug 2026 02:14:23 GMT",
  items: [{
    title: "openai/codex",
    url: "https://github.com/openai/codex",
    description: "Developer agent",
    language: "TypeScript",
    languageColor: "#3178c6",
    stars: "12,345",
    forks: "1.2k",
    addStars: "456",
    contributors: [],
  }],
};

describe("GitHub Trending parser", () => {
  it("解析仓库排名和 GitHub 指标", () => {
    expect(parseGitHubTrendingHtml(TRENDING_HTML)).toEqual([
      {
        rank: 1,
        fullName: "openai/codex",
        url: "https://github.com/openai/codex",
        description: "A & B developer agent",
        language: "TypeScript",
        stars: 12_345,
        forks: 1_200,
        starsInPeriod: 456,
      },
      {
        rank: 2,
        fullName: "vuejs/core",
        url: "https://github.com/vuejs/core",
        description: null,
        language: null,
        stars: 50_001,
        forks: 9_876,
        starsInPeriod: 1_500,
      },
    ]);
  });

  it("拒绝空榜和指标结构漂移", () => {
    expect(() => parseGitHubTrendingHtml("<main><h1>Trending</h1></main>"))
      .toThrow("没有可识别的仓库条目");
    expect(() => parseGitHubTrendingHtml(`
      <article class="Box-row">
        <h2><a href="/owner/repo">owner/repo</a></h2>
      </article>
    `)).toThrow("指标结构无法识别");
  });

  it("构造周期和语言 URL，并拒绝异常语言", () => {
    expect(buildGitHubTrendingUrl("weekly", "typescript"))
      .toBe("https://github.com/trending/typescript?since=weekly");
    expect(buildGitHubTrendingUrl("monthly"))
      .toBe("https://github.com/trending?since=monthly");
    expect(() => buildGitHubTrendingUrl("daily", "../login"))
      .toThrow("无效 GitHub Trending 语言");
    expect(buildGitHubTrendingFallbackUrl("weekly", "typescript"))
      .toBe("https://raw.githubusercontent.com/isboyjc/github-trending-api/main/data/weekly/typescript.json");
  });

  it("严格解析 GitHub 托管的社区快照，并拒绝过期数据", () => {
    expect(parseGitHubTrendingFallbackJson(
      FALLBACK_JSON,
      new Date("2026-08-18T03:00:00.000Z"),
    )).toEqual([{
      rank: 1,
      fullName: "openai/codex",
      url: "https://github.com/openai/codex",
      description: "Developer agent",
      language: "TypeScript",
      stars: 12_345,
      forks: 1_200,
      starsInPeriod: 456,
    }]);

    expect(() => parseGitHubTrendingFallbackJson(
      FALLBACK_JSON,
      new Date("2026-08-21T03:00:00.000Z"),
    )).toThrow("快照已过期");
  });

  it("请求页面后解析，HTTP 错误直接失败", async () => {
    const fetchOk = vi.fn().mockResolvedValue(new Response(TRENDING_HTML, { status: 200 }));
    const result = await fetchGitHubTrending("daily", "all", fetchOk);
    expect(result).toMatchObject({ period: "daily", language: "all" });
    expect(result.entries[0]).toMatchObject({ fullName: "openai/codex" });

    const fetchFailed = vi.fn().mockResolvedValue(new Response("rate limited", {
      status: 429,
      statusText: "Too Many Requests",
    }));
    await expect(fetchGitHubTrending("daily", "all", fetchFailed))
      .rejects.toThrow("429 Too Many Requests");
  });

  it("官方 HTML 不可达时回退到新鲜的 GitHub 托管快照", async () => {
    const fetchWithFallback = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify(FALLBACK_JSON), { status: 200 }));

    const result = await fetchGitHubTrending(
      "daily",
      "all",
      fetchWithFallback,
      () => new Date("2026-08-18T03:00:00.000Z"),
    );

    expect(fetchWithFallback).toHaveBeenCalledTimes(2);
    expect(result.sourceUrl).toBe(
      "https://raw.githubusercontent.com/isboyjc/github-trending-api/main/data/daily/all.json",
    );
    expect(result.entries[0]).toMatchObject({
      fullName: "openai/codex",
      starsInPeriod: 456,
    });
  });
});
