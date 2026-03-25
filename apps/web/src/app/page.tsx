/**
 * @package @devscope/web
 * @description 首页组件
 *
 * DevScope 应用的首页，展示已采集的仓库列表。
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { RepositoryCard } from "@/components/repository-card";
import { CollectForm } from "@/components/collect-form";
import { FollowingList } from "@/components/following-list";
import { Navigation } from "@/components/navigation";
import { ViewModeToggle, useViewMode } from "@/components/view-toggle";
import { SortControl, useSortPreferences, sortRepositories } from "@/components/sort-control";
import { Button } from "@/components/ui/button";
import { AnimatedBackground, FadeInItem } from "@/components/animated-background";
import { motion } from "framer-motion";
import { useMemo } from "react";

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"collect" | "following">("collect");
  const [viewMode, setViewMode] = useViewMode("card");
  const { sortBy, order, setSortBy, toggleOrder } = useSortPreferences("stars", "desc");

  // 获取仓库列表
  const { data: repositories, isLoading, error, refetch } = trpc.getRepositories.useQuery(
    undefined,
    {
      enabled: true,
      refetchOnWindowFocus: false,
    }
  );

  // 应用排序
  const sortedRepositories = useMemo(() => {
    if (!repositories) return repositories;
    return sortRepositories(repositories, sortBy, order);
  }, [repositories, sortBy, order]);

  const handleViewDetails = (id: number) => {
    router.push(`/repository/${id}`);
  };

  const handleCollected = () => {
    refetch();
  };

  const handleSelectFromFollowing = (fullName: string) => {
    // 切换到采集标签并触发采集
    setActiveTab("collect");
    // CollectForm 组件会在下次渲染时收到这个 repo
    (window as any).__pendingCollectRepo = fullName;
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
            DevScope
          </motion.h1>
          <Navigation />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="grid gap-8 lg:grid-cols-3">
          {/* 左侧：标签页 */}
          <div className="lg:col-span-1">
            {/* 标签切换 */}
            <div className="flex gap-2 mb-4">
              <Button
                size="sm"
                variant={activeTab === "collect" ? "default" : "outline"}
                onClick={() => setActiveTab("collect")}
              >
                采集仓库
              </Button>
              <Button
                size="sm"
                variant={activeTab === "following" ? "default" : "outline"}
                onClick={() => setActiveTab("following")}
              >
                我的关注
              </Button>
            </div>

            {/* 标签内容 */}
            {activeTab === "collect" ? (
              <CollectForm onCollected={handleCollected} />
            ) : (
              <FollowingList onSelectRepo={handleSelectFromFollowing} />
            )}
          </div>

          {/* 右侧：仓库列表 */}
          <div className="lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                已采集仓库 {repositories && `(${repositories.length})`}
              </h2>
              <div className="flex items-center gap-3">
                <SortControl
                  value={sortBy}
                  order={order}
                  onSortChange={setSortBy}
                  onOrderToggle={toggleOrder}
                />
                <ViewModeToggle value={viewMode} onChange={setViewMode} />
              </div>
            </div>

            {isLoading && (
              <div className="text-center py-8 text-muted-foreground">
                加载中...
              </div>
            )}

            {error && (
              <div className="text-center py-8 text-red-500">
                加载失败: {error.message}
              </div>
            )}

            {sortedRepositories && sortedRepositories.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p className="mb-4">还没有采集任何仓库数据</p>
                <p className="text-sm">在左侧输入仓库地址开始采集</p>
              </div>
            )}

            {sortedRepositories && sortedRepositories.length > 0 && (
              <div className={viewMode === "card" ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "grid gap-3"}>
                {sortedRepositories.map((repo, index) => (
                  <FadeInItem key={repo.id} index={index}>
                    <RepositoryCard
                      repository={repo}
                      onViewDetails={handleViewDetails}
                      viewMode={viewMode}
                    />
                  </FadeInItem>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
