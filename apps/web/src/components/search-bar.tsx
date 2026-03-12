/**
 * @package @devscope/web
 * @description 搜索输入组件
 *
 * 提供搜索输入框和相关控制。
 */

import { Button } from "@/components/ui/button";

interface SearchBarProps {
  query: string;
  setQuery: (q: string) => void;
  repo: string;
  setRepo: (r: string) => void;
  onSearch: () => void;
  isLoading: boolean;
}

export function SearchBar({
  query,
  setQuery,
  repo,
  setRepo,
  onSearch,
  isLoading,
}: SearchBarProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <input
        type="text"
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
        placeholder="owner/repo"
        className="px-4 py-2 border border-input rounded-md bg-background text-sm"
        disabled={isLoading}
      />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Ask a question about the repository..."
        className="flex-1 px-4 py-2 border border-input rounded-md bg-background text-sm"
        onKeyDown={(e) => e.key === "Enter" && onSearch()}
        disabled={isLoading}
      />
      <Button
        onClick={onSearch}
        disabled={isLoading || !query.trim() || !repo.trim()}
      >
        {isLoading ? "Searching..." : "Search"}
      </Button>
    </div>
  );
}
