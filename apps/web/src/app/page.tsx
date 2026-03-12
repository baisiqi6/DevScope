/**
 * @package @devscope/web
 * @description 首页组件
 *
 * DevScope 应用的首页，展示已采集的仓库列表。
 */

"use client";

import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { RepositoryCard } from "@/components/repository-card";
import { CollectForm } from "@/components/collect-form";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const router = useRouter();

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
          {/* 左侧：采集表单 */}
          <div className="lg:col-span-1">
            <CollectForm onCollected={handleCollected} />
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
