/**
 * @package @devscope/web
 * @description 关注列表组件
 *
 * 显示用户在 GitHub 上关注的仓库列表。
 */

'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, Download, RefreshCw, Star } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from './ui/button';
import {
  FollowingSortControl,
  type FollowingSortBy,
  type SortOrder,
} from './following-sort-control';

interface FollowingListProps {
  onSelectRepo?: (fullName: string) => void;
}

export function FollowingList({ onSelectRepo }: FollowingListProps) {
  const router = useRouter();
  const [limit, setLimit] = useState(30);
  const [sortBy, setSortBy] = useState<FollowingSortBy>('followedAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const {
    data: following,
    isLoading,
    error,
    refetch,
  } = trpc.getFollowing.useQuery(
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
      case 'name':
        sorted.sort((a, b) => {
          const compare = a.fullName.localeCompare(b.fullName);
          return sortOrder === 'asc' ? compare : -compare;
        });
        break;
      case 'stars':
        sorted.sort((a, b) => {
          const compare = a.stars - b.stars;
          return sortOrder === 'asc' ? compare : -compare;
        });
        break;
      case 'followedAt':
        sorted.sort((a, b) => {
          const dateA = new Date((a as any).starredAt || a.updatedAt).getTime();
          const dateB = new Date((b as any).starredAt || b.updatedAt).getTime();
          const compare = dateA - dateB;
          return sortOrder === 'asc' ? compare : -compare;
        });
        break;
    }

    return sorted;
  }, [following, sortBy, sortOrder]);

  const handleCollect = (fullName: string) => {
    if (onSelectRepo) {
      onSelectRepo(fullName);
    }
  };

  return (
    <div className="pr-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">我的 GitHub 关注</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            从已关注仓库中选择采集目标，或直接查看统计。
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FollowingSortControl
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSortChange={(newSortBy, newSortOrder) => {
              setSortBy(newSortBy);
              setSortOrder(newSortOrder);
            }}
          />
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw />
            刷新
          </Button>
          {following && following.length >= limit && (
            <Button size="sm" variant="outline" onClick={() => setLimit(Math.min(limit + 30, 100))}>
              加载更多
            </Button>
          )}
        </div>
      </div>
      <div className="mt-5">
        {isLoading && (
          <div aria-busy="true" className="space-y-2" aria-label="正在加载关注列表">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-md bg-muted/60" />
            ))}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            关注列表加载失败：{error.message}
          </div>
        )}

        {following && following.length === 0 && (
          <div className="rounded-md border border-dashed py-8 text-center">
            <p className="font-medium">没有找到关注的仓库</p>
            <p className="mt-1 text-sm text-muted-foreground">
              请确认 GitHub Token 可以读取关注列表。
            </p>
          </div>
        )}

        {following && following.length > 0 && (
          <div className="divide-y rounded-md border">
            {sortedFollowing.map((repo) => (
              <div
                key={repo.fullName}
                className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <a
                    href={repo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    {repo.fullName}
                  </a>
                  {repo.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {repo.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Star className="h-3.5 w-3.5" />
                      <span>{repo.stars.toLocaleString()}</span>
                    </div>
                    {repo.language && <span>{repo.language}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleCollect(repo.fullName)}>
                    <Download />
                    采集
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      router.push(`/repo-stats?repo=${encodeURIComponent(repo.fullName)}`)
                    }
                  >
                    <BarChart3 />
                    统计
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
