/**
 * @package @devscope/web
 * @description 关注列表组件
 *
 * 显示用户在 GitHub 上关注的仓库列表。
 */

"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";

interface FollowingRepo {
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  url: string;
  stars: number;
  language: string | null;
  updatedAt: Date;
}

interface FollowingListProps {
  onSelectRepo?: (fullName: string) => void;
}

export function FollowingList({ onSelectRepo }: FollowingListProps) {
  const [limit, setLimit] = useState(30);

  const { data: following, isLoading, error, refetch } = trpc.getFollowing.useQuery(
    { limit },
    {
      enabled: true,
      refetchOnWindowFocus: false,
    }
  );

  const handleCollect = (fullName: string) => {
    if (onSelectRepo) {
      onSelectRepo(fullName);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>我的关注列表</span>
          <div className="flex gap-2">
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
            {following.map((repo) => (
              <div
                key={repo.fullName}
                className="p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCollect(repo.fullName)}
                  >
                    采集
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
