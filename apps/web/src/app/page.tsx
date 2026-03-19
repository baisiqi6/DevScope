/**
 * @package @devscope/web
 * @description 首页组件
 *
 * DevScope 应用的首页，展示已采集的仓库列表。
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { RepositoryCard } from "@/components/repository-card";
import { CollectForm } from "@/components/collect-form";
import { FollowingList } from "@/components/following-list";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"collect" | "following">("collect");

  // 获取仓库列表
  const { data: repositories, isLoading, error, refetch } = trpc.getRepositories.useQuery(
    undefined,
    {
      enabled: true,
      refetchOnWindowFocus: false,
    }
  );

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
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">DevScope</h1>
          <nav className="flex gap-4">
            <Button variant="ghost" onClick={() => router.push("/")}>
              仓库列表
            </Button>
            <Button variant="ghost" onClick={() => router.push("/search")}>
              语义搜索
            </Button>
          </nav>
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

            {repositories && repositories.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p className="mb-4">还没有采集任何仓库数据</p>
                <p className="text-sm">在左侧输入仓库地址开始采集</p>
              </div>
            )}

            {repositories && repositories.length > 0 && (
              <div className="grid gap-4">
                {repositories.map((repo) => (
                  <RepositoryCard
                    key={repo.id}
                    repository={repo}
                    onViewDetails={handleViewDetails}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
