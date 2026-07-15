/** 语义搜索输入组件。 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <form
      className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="search-repository">仓库</Label>
        <Input
          id="search-repository"
          type="text"
          value={repo}
          onChange={(event) => setRepo(event.target.value)}
          placeholder="owner/repo"
          autoComplete="off"
          disabled={isLoading}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="search-question">问题</Label>
        <Input
          id="search-question"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入想从仓库文档中查找的问题"
          autoComplete="off"
          disabled={isLoading}
        />
      </div>
      <Button type="submit" disabled={isLoading || !query.trim() || !repo.trim()}>
        {isLoading ? "搜索中..." : "搜索"}
      </Button>
    </form>
  );
}
