/**
 * @package @devscope/web
 * @description 关注列表组件
 *
 * 显示用户在 GitHub 上关注的仓库列表。
 */

"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { FollowingSortControl, type FollowingSortBy, type SortOrder } from "./following-sort-control";

interface FollowingListProps {
  onSelectRepo?: (fullName: string) => void;
}

export function FollowingList({ onSelectRepo }: FollowingListProps) {
  const router = useRouter();
  const [limit, setLimit] = useState(30);
  const [analyzingRepo, setAnalyzingRepo] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<FollowingSortBy>("followedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const { data: following, isLoading, error, refetch } = trpc.getFollowing.useQuery(
    { limit },
    {
      enabled: true,
      refetchOnWindowFocus: false,
    }
  );

  // 排序后的关注列表
  const sortedFollowing = useMemo(() => {
    if (!following) return [];

    const sorted = [...following];

    switch (sortBy) {
      case "name":
        sorted.sort((a, b) => {
          const compare = a.fullName.localeCompare(b.fullName);
          return sortOrder === "asc" ? compare : -compare;
        });
        break;
      case "stars":
        sorted.sort((a, b) => {
          const compare = a.stars - b.stars;
          return sortOrder === "asc" ? compare : -compare;
        });
        break;
      case "followedAt":
        // 按关注时间排序（使用 updatedAt 作为关注时间的近似）
        sorted.sort((a, b) => {
          const dateA = new Date(a.updatedAt).getTime();
          const dateB = new Date(b.updatedAt).getTime();
          const compare = dateA - dateB;
          return sortOrder === "asc" ? compare : -compare;
        });
        break;
    }

    return sorted;
  }, [following, sortBy, sortOrder]);

  // 单个仓库分析
  const analyzeSingleMutation = trpc.workflow.analyzeRepo.useMutation({
    onSuccess: (data) => {
      setAnalyzingRepo(null);
      // 保存结果到 sessionStorage
      sessionStorage.setItem("analysisResult", JSON.stringify(data));
      // 跳转到分析结果页面
      router.push(`/analysis?executionId=${data.execution_id}`);
    },
    onError: (error) => {
      setAnalyzingRepo(null);
      alert(`分析失败: ${error.message}`);
    },
  });

  const handleCollect = (fullName: string) => {
    if (onSelectRepo) {
      onSelectRepo(fullName);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between flex-wrap gap-3">
          <span>我的关注列表</span>
          <div className="flex items-center gap-2 flex-wrap">
            <FollowingSortControl
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSortChange={(newSortBy, newSortOrder) => {
                setSortBy(newSortBy);
                setSortOrder(newSortOrder);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
            >
              刷新
            </Button>
            {following && following.length >= limit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLimit(Math.min(limit + 30, 100))}
              >
                加载更多
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
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

        {following && following.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p className="mb-2">没有找到关注的仓库</p>
            <p className="text-sm">请确认已在 GitHub 上关注一些仓库</p>
          </div>
        )}

        {following && following.length > 0 && (
          <div className="space-y-3">
            {sortedFollowing.map((repo) => (
              <div
                key={repo.fullName}
                className="p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex flex-col gap-3">
                  <div className="flex-1 min-w-0">
                    <a
                      href={repo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 font-semibold text-sm"
                    >
                      {repo.fullName}
                    </a>
                    {repo.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {repo.description}
                      </p>
                    )}
                    <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <span>⭐</span>
                        <span>{repo.stars.toLocaleString()}</span>
                      </div>
                      {repo.language && (
                        <div className="flex items-center gap-1">
                          <span>🔷</span>
                          <span>{repo.language}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-600 hover:to-green-700 border-0 shadow-md hover:shadow-lg transition-all"
                      onClick={() => handleCollect(repo.fullName)}
                    >
                      <span className="mr-1.5">📥</span>采集
                    </Button>
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700 border-0 shadow-md hover:shadow-lg transition-all"
                      onClick={() => window.location.href = `/repo-stats?repo=${encodeURIComponent(repo.fullName)}`}
                    >
                      <span className="mr-1.5">📊</span>统计
                    </Button>
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-purple-500 to-pink-600 text-white hover:from-purple-600 hover:to-pink-700 border-0 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                      disabled={analyzingRepo === repo.fullName}
                      onClick={() => {
                        setAnalyzingRepo(repo.fullName);
                        analyzeSingleMutation.mutate({ repo: repo.fullName });
                      }}
                    >
                      <span className="mr-1.5">{analyzingRepo === repo.fullName ? "⏳" : "🤖"}</span>
                      {analyzingRepo === repo.fullName ? "分析中..." : "AI分析"}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
