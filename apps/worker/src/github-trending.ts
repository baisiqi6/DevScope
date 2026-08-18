import { load } from "cheerio";

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
  const normalizedLanguage = language.trim().toLowerCase() || "all";
  if (normalizedLanguage !== "all" && !/^[a-z0-9+.#-]+$/.test(normalizedLanguage)) {
    throw new Error(`无效 GitHub Trending 语言: ${language}`);
  }

  const path = normalizedLanguage === "all"
    ? "/trending"
    : `/trending/${encodeURIComponent(normalizedLanguage)}`;
  const url = new URL(path, "https://github.com");
  url.searchParams.set("since", period);
  return url.toString();
}

export async function fetchGitHubTrending(
  period: GitHubTrendingPeriod,
  language = "all",
  fetchImpl: FetchLike = fetch,
): Promise<GitHubTrendingResult> {
  const sourceUrl = buildGitHubTrendingUrl(period, language);
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
    language: language.trim().toLowerCase() || "all",
    sourceUrl,
    entries: parseGitHubTrendingHtml(await response.text()),
  };
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
