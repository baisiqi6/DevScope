/**
 * 语言→颜色静态映射，遵循 GitHub Linguist 语言色约定
 * （https://github.com/github-linguist/linguist/blob/master/lib/linguist/languages.yml）。
 * 少数原色在深色主题下过暗，已调亮：C、Lua、Dockerfile、Ruby。
 * 未收录语言返回 null，调用方回退到 muted-foreground 语义 token。
 */
const LANGUAGE_COLORS: Record<string, string> = {
  C: "#8f9aa3",
  "C#": "#178600",
  "C++": "#f34b7d",
  CSS: "#6639ba",
  Dart: "#00b4ab",
  Dockerfile: "#4d6b76",
  Elixir: "#6e4a7e",
  Go: "#00add8",
  Haskell: "#5e5086",
  HTML: "#e34c26",
  Java: "#b07219",
  JavaScript: "#f1e05a",
  Julia: "#a270ba",
  Kotlin: "#a97bff",
  Lua: "#4672a8",
  "Objective-C": "#438eff",
  PHP: "#4f5d95",
  Python: "#3572a5",
  R: "#198ce7",
  Ruby: "#cc342d",
  Rust: "#dea584",
  Scala: "#c22d40",
  Shell: "#89e051",
  Swift: "#f05138",
  TypeScript: "#3178c6",
  Vue: "#41b883",
  Zig: "#ec915c",
};

export function languageColor(language: string | null | undefined): string | null {
  if (!language) return null;
  return LANGUAGE_COLORS[language] ?? null;
}
