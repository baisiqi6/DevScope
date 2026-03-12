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
    <main className="min-h-screen py-8 px-4">
      <div className="container mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Semantic Search</h1>
          <p className="text-muted-foreground">
            Search through repository documentation using AI-powered semantic search.
          </p>
        </div>

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
          <div className="mb-6 p-4 bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
            <p className="font-medium mb-1">Error</p>
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
          <div className="mt-8 p-6 bg-muted/30 rounded-lg border">
            <h2 className="text-lg font-semibold mb-4">Example Queries</h2>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                • <strong>For Next.js:</strong> "How to deploy Next.js on Vercel?"
              </p>
              <p>
                • <strong>For React:</strong> "What are React hooks and how to use them?"
              </p>
              <p>
                • <strong>For TypeScript:</strong> "How to define generic types?"
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
