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
import { motion } from "framer-motion";

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
      {/* 动画背景 */}
      <AnimatedBackground />

      <div className="container mx-auto max-w-4xl px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <h1 className="text-3xl font-bold mb-2 text-slate-800">语义搜索</h1>
          <p className="text-slate-600">
            使用 AI 驱动的语义搜索技术，在仓库文档中快速找到你需要的内容。
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="mb-6"
        >
          <SearchBar
            query={query}
            setQuery={setQuery}
            repo={repo}
            setRepo={setRepo}
            onSearch={handleSearch}
            isLoading={searchMutation.isPending}
          />
        </motion.div>

        {searchMutation.error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            role="alert"
            className="mb-6 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-destructive"
          >
            <p className="mb-1 font-medium">搜索失败</p>
            <p className="text-sm">{searchMutation.error.message}</p>
          </motion.div>
        )}

        {searchMutation.data && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-6"
          >
            {searchMutation.data.answer && (
              <AnswerCard answer={searchMutation.data.answer} />
            )}

            <SearchResults
              chunks={searchMutation.data.chunks}
              repository={searchMutation.data.repository}
              duration={searchMutation.data.duration}
            />
          </motion.div>
        )}

        {/* 示例查询 */}
        {!searchMutation.data && !searchMutation.error && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mt-8 p-6 bg-white/60 backdrop-blur-sm rounded-lg border border-slate-200/60 shadow-lg"
          >
            <h2 className="text-lg font-semibold mb-4 text-slate-800">示例查询</h2>
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
          </motion.div>
        )}
      </div>
    </main>
  );
}
