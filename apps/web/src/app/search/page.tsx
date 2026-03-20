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
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function SearchPage() {
  const router = useRouter();
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

      {/* Header */}
      <header className="border-b border-slate-200/60 bg-white/70 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <motion.h1
            className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            语义搜索
          </motion.h1>
          <Button
            variant="ghost"
            onClick={() => router.push("/")}
            className="hover:bg-blue-50 hover:text-blue-600 transition-colors"
          >
            返回首页
          </Button>
        </div>
      </header>

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
            className="mb-6 p-4 bg-red-50 text-red-600 rounded-lg border border-red-200"
          >
            <p className="font-medium mb-1">Error</p>
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
            <div className="space-y-2 text-sm text-slate-600">
              <p className="hover:bg-blue-50 p-2 rounded transition-colors cursor-pointer" onClick={() => { setRepo("vercel/next.js"); setQuery("How to deploy Next.js on Vercel?"); }}>
                • <strong>For Next.js:</strong> "How to deploy Next.js on Vercel?"
              </p>
              <p className="hover:bg-blue-50 p-2 rounded transition-colors cursor-pointer" onClick={() => { setRepo("facebook/react"); setQuery("What are React hooks and how to use them?"); }}>
                • <strong>For React:</strong> "What are React hooks and how to use them?"
              </p>
              <p className="hover:bg-blue-50 p-2 rounded transition-colors cursor-pointer" onClick={() => { setRepo("microsoft/TypeScript"); setQuery("How to define generic types?"); }}>
                • <strong>For TypeScript:</strong> "How to define generic types?"
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </main>
  );
}
