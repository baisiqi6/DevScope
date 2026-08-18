import { load } from "cheerio";
import { z } from "zod";

export const GITHUB_TRENDING_PERIODS = ["daily", "weekly", "monthly"] as const;

export type GitHubTrendingPeriod = (typeof GITHUB_TRENDING_PERIODS)[number];

export interface GitHubTrendingEntry {
  rank: number;
  fullName: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  starsInPeriod: number;
}

export interface GitHubTrendingResult {
  period: GitHubTrendingPeriod;
  language: string;
  sourceUrl: string;
  entries: GitHubTrendingEntry[];
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const GITHUB_TRENDING_FALLBACK_BASE_URL =
  "https://raw.githubusercontent.com/isboyjc/github-trending-api/main/data/";
const GITHUB_TRENDING_FALLBACK_MAX_AGE_MS = 48 * 60 * 60 * 1_000;

const githubTrendingFallbackSchema = z.object({
  pubDate: z.string().min(1),
  items: z.array(z.object({
    title: z.string().min(1),
    url: z.string().url(),
    description: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    stars: z.union([z.string(), z.number()]),
    forks: z.union([z.string(), z.number()]),
    addStars: z.union([z.string(), z.number()]),
  })).min(1).max(100),
});

/**
 * GitHub Trending 是服务端渲染页面，没有公开 REST Trending endpoint。
 * 这里只解析榜单稳定语义，不复制第三方 API 或引入浏览器运行时。
 */
export function parseGitHubTrendingHtml(html: string): GitHubTrendingEntry[] {
  const $ = load(html);
  const entries: GitHubTrendingEntry[] = [];

  $("article.Box-row").each((index, element) => {
    const article = $(element);
    const repositoryLink = article.find("h2 a[href]").first();
    const fullName = parseRepositoryFullName(repositoryLink.attr("href"));

    if (!fullName) {
      throw new Error(`GitHub Trending 第 ${index + 1} 项缺少有效仓库链接`);
    }

    const stars = parseMetricLink(article, fullName, "stargazers");
    const forks = parseMetricLink(article, fullName, "forks");
    const starsInPeriod = parseStarsInPeriod(article.text());

    if (stars === null || forks === null || starsInPeriod === null) {
      throw new Error(`GitHub Trending 指标结构无法识别: ${fullName}`);
    }

    const descriptionText = normalizeText(
      article.find("p.col-9, p.my-1, p").first().text(),
    );
    const languageText = normalizeText(
      article.find('[itemprop="programmingLanguage"]').first().text(),
    );

    entries.push({
      rank: index + 1,
      fullName,
      url: `https://github.com/${fullName}`,
      description: descriptionText || null,
      language: languageText || null,
      stars,
      forks,
      starsInPeriod,
    });
  });

  if (entries.length === 0) {
    throw new Error("GitHub Trending 页面没有可识别的仓库条目");
  }

  return entries;
}

export function buildGitHubTrendingUrl(
  period: GitHubTrendingPeriod,
  language = "all",
): string {
  const normalizedLanguage = normalizeLanguage(language);

  const path = normalizedLanguage === "all"
    ? "/trending"
    : `/trending/${encodeURIComponent(normalizedLanguage)}`;
  const url = new URL(path, "https://github.com");
  url.searchParams.set("since", period);
  return url.toString();
}

export function buildGitHubTrendingFallbackUrl(
  period: GitHubTrendingPeriod,
  language = "all",
): string {
  const normalizedLanguage = normalizeLanguage(language);
  return new URL(
    `${period}/${encodeURIComponent(normalizedLanguage)}.json`,
    GITHUB_TRENDING_FALLBACK_BASE_URL,
  ).toString();
}

export function parseGitHubTrendingFallbackJson(
  input: unknown,
  now = new Date(),
): GitHubTrendingEntry[] {
  const snapshot = githubTrendingFallbackSchema.parse(input);
  const publishedAt = new Date(snapshot.pubDate);
  const ageMs = now.getTime() - publishedAt.getTime();

  if (!Number.isFinite(publishedAt.getTime())) {
    throw new Error("GitHub Trending 回退快照时间无效");
  }
  if (ageMs < -10 * 60 * 1_000 || ageMs > GITHUB_TRENDING_FALLBACK_MAX_AGE_MS) {
    throw new Error(`GitHub Trending 回退快照已过期: ${snapshot.pubDate}`);
  }

  return snapshot.items.map((item, index) => {
    const repositoryUrl = new URL(item.url);
    const fullName = parseRepositoryFullName(repositoryUrl.pathname);
    if (
      repositoryUrl.protocol !== "https:" ||
      repositoryUrl.hostname !== "github.com" ||
      !fullName ||
      normalizeText(item.title) !== fullName
    ) {
      throw new Error(`GitHub Trending 回退快照第 ${index + 1} 项仓库标识无效`);
    }

    const stars = parseGitHubCount(String(item.stars));
    const forks = parseGitHubCount(String(item.forks));
    const starsInPeriod = parseGitHubCount(String(item.addStars));
    if (stars === null || forks === null || starsInPeriod === null) {
      throw new Error(`GitHub Trending 回退快照指标无法识别: ${fullName}`);
    }

    return {
      rank: index + 1,
      fullName,
      url: repositoryUrl.toString(),
      description: item.description ? normalizeText(item.description) : null,
      language: item.language ? normalizeText(item.language) : null,
      stars,
      forks,
      starsInPeriod,
    };
  });
}

export async function fetchGitHubTrending(
  period: GitHubTrendingPeriod,
  language = "all",
  fetchImpl: FetchLike = fetch,
  now: () => Date = () => new Date(),
): Promise<GitHubTrendingResult> {
  const sourceUrl = buildGitHubTrendingUrl(period, language);
  try {
    const response = await fetchImpl(sourceUrl, {
      headers: {
        Accept: "text/html",
        "User-Agent": "DevScope/0.1 (+https://github.com)",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(`GitHub Trending 请求失败: ${response.status} ${response.statusText}`);
    }

    return {
      period,
      language: normalizeLanguage(language),
      sourceUrl,
      entries: parseGitHubTrendingHtml(await response.text()),
    };
  } catch (officialError) {
    const fallbackUrl = buildGitHubTrendingFallbackUrl(period, language);
    try {
      const fallbackResponse = await fetchImpl(fallbackUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "DevScope/0.1 (+https://github.com)",
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!fallbackResponse.ok) {
        throw new Error(
          `GitHub Trending 回退快照请求失败: ${fallbackResponse.status} ${fallbackResponse.statusText}`,
        );
      }

      return {
        period,
        language: normalizeLanguage(language),
        sourceUrl: fallbackUrl,
        entries: parseGitHubTrendingFallbackJson(await fallbackResponse.json(), now()),
      };
    } catch (fallbackError) {
      throw new Error(
        `GitHub Trending 官方页面与回退快照均不可用: ${errorMessage(officialError)}; ${errorMessage(fallbackError)}`,
        { cause: fallbackError },
      );
    }
  }
}

function parseRepositoryFullName(href: string | undefined): string | null {
  if (!href) return null;

  const pathname = new URL(href, "https://github.com").pathname;
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length !== 2 || parts.some((part) => !/^[\w.-]+$/.test(part))) {
    return null;
  }

  return `${parts[0]}/${parts[1]}`;
}

function parseMetricLink(
  article: ReturnType<ReturnType<typeof load>>,
  fullName: string,
  metric: "stargazers" | "forks",
): number | null {
  const expectedPath = `/${fullName}/${metric}`.toLowerCase();
  let value: number | null = null;

  article.find("a[href]").each((_, link) => {
    if (value !== null) return;
    const href = article.find(link).attr("href");
    if (!href) return;
    const pathname = new URL(href, "https://github.com").pathname.toLowerCase();
    if (pathname === expectedPath) {
      value = parseGitHubCount(article.find(link).text());
    }
  });

  return value;
}

function parseStarsInPeriod(text: string): number | null {
  const match = normalizeText(text).match(
    /([\d,.]+(?:\.\d+)?[kKmM]?)\s+stars?\s+(?:today|this week|this month)\b/i,
  );
  return match ? parseGitHubCount(match[1]) : null;
}

function parseGitHubCount(value: string): number | null {
  const normalized = normalizeText(value).replaceAll(",", "").toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!match) return null;

  const multiplier = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase() || "all";
  if (normalized !== "all" && !/^[a-z0-9+.#-]+$/.test(normalized)) {
    throw new Error(`无效 GitHub Trending 语言: ${language}`);
  }
  return normalized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
