/**
 * @package @devscope/web
 * @description 搜索页面
 *
 * 提供语义搜索功能，允许用户查询已采集的仓库内容。
 */

"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { SearchBar } from "@/components/search-bar";
import { SearchResults } from "@/components/search-results";
import { AnswerCard } from "@/components/answer-card";
import { AnimatedBackground } from "@/components/animated-background";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [repo, setRepo] = useState("vercel/next.js");

  const searchMutation = trpc.semanticSearch.useMutation();

  const handleSearch = () => {
    if (query.trim() && repo.trim()) {
      searchMutation.mutate({
        repo,
        query,
        limit: 5,
        generateAnswer: true,
      });
    }
  };

  return (
    <main className="min-h-screen">
      <AnimatedBackground />

      <div className="container mx-auto max-w-4xl px-4 py-6 sm:py-8">
        <header className="command-page-header mb-6">
          <p className="command-kicker">语义检索</p>
          <h1 className="text-2xl font-semibold tracking-tight">语义搜索</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            使用 AI 驱动的语义搜索技术，在仓库文档中快速找到你需要的内容。
          </p>
        </header>

        <div className="mb-6">
          <SearchBar
            query={query}
            setQuery={setQuery}
            repo={repo}
            setRepo={setRepo}
            onSearch={handleSearch}
            isLoading={searchMutation.isPending}
          />
        </div>

        {searchMutation.error && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-destructive"
          >
            <p className="mb-1 font-medium">搜索失败</p>
            <p className="text-sm">{searchMutation.error.message}</p>
          </div>
        )}

        {searchMutation.data && (
          <div className="space-y-6">
            {searchMutation.data.answer && (
              <AnswerCard answer={searchMutation.data.answer} />
            )}

            <SearchResults
              chunks={searchMutation.data.chunks}
              repository={searchMutation.data.repository}
              duration={searchMutation.data.duration}
            />
          </div>
        )}

        {/* 示例查询 */}
        {!searchMutation.data && !searchMutation.error && (
          <section aria-label="示例查询" className="command-surface mt-8 p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-semibold">示例查询</h2>
            <div className="grid gap-2 text-sm text-muted-foreground">
              <button
                type="button"
                className="min-h-10 rounded-md p-2 text-left transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => { setRepo("vercel/next.js"); setQuery("如何将 Next.js 部署到 Vercel？"); }}
              >
                <strong>Next.js：</strong>如何将项目部署到 Vercel？
              </button>
              <button
                type="button"
                className="min-h-10 rounded-md p-2 text-left transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => { setRepo("facebook/react"); setQuery("React Hooks 是什么，应该如何使用？"); }}
              >
                <strong>React：</strong>Hooks 是什么，应该如何使用？
              </button>
              <button
                type="button"
                className="min-h-10 rounded-md p-2 text-left transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => { setRepo("microsoft/TypeScript"); setQuery("如何定义泛型类型？"); }}
              >
                <strong>TypeScript：</strong>如何定义泛型类型？
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
