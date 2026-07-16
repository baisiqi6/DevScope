'use client';

import { useMemo, useState, useCallback } from 'react';
import { skipToken } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { CreateGroupInput, Repository, RepositoryGroup } from '@devscope/shared';
import { trpc } from '@/lib/trpc';
import { RepositoryCard } from '@/components/repository-card';
import { CollectForm } from '@/components/collect-form';
import { FollowingList } from '@/components/following-list';
import { ViewModeToggle, useViewMode } from '@/components/view-toggle';
import { SortControl, sortRepositories, useSortPreferences } from '@/components/sort-control';
import { GroupTabs } from '@/components/group-tabs';
import { CreateGroupDialog } from '@/components/create-group-dialog';
import { Button } from '@/components/ui/button';
import { AnimatedBackground } from '@/components/animated-background';
import { Plus, RefreshCw, Star, X } from 'lucide-react';

function dedupeRepositories<T extends { id: number }>(repos: T[]): T[] {
  return Array.from(new Map(repos.map((repo) => [repo.id, repo])).values());
}

function normalizeRepository(repo: {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  description?: string | null;
  url: string;
  stars?: number | null;
  forks?: number | null;
  openIssues?: number | null;
  language?: string | null;
  license?: string | null;
  lastFetchedAt?: string | Date | null;
  starredAt?: string | Date | null;
  note?: string | null;
}): Repository {
  return {
    id: repo.id,
    fullName: repo.fullName,
    name: repo.name,
    owner: repo.owner,
    description: repo.description ?? undefined,
    url: repo.url,
    stars: repo.stars ?? 0,
    forks: repo.forks ?? 0,
    openIssues: repo.openIssues ?? 0,
    language: repo.language ?? undefined,
    license: repo.license ?? undefined,
    lastFetchedAt:
      typeof repo.lastFetchedAt === 'string'
        ? repo.lastFetchedAt
        : repo.lastFetchedAt?.toISOString(),
    starredAt: typeof repo.starredAt === 'string' ? repo.starredAt : repo.starredAt?.toISOString(),
    note: repo.note ?? undefined,
  };
}

export default function HomePage() {
  const router = useRouter();
  const [activePanel, setActivePanel] = useState<'collect' | 'following' | null>(null);
  const [viewMode, setViewMode] = useViewMode('list');
  const { sortBy, order, setSortBy, toggleOrder } = useSortPreferences('stars', 'desc');
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [isUngroupedSelected, setIsUngroupedSelected] = useState(false);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
  const [repoLimit, setRepoLimit] = useState(50);

  const {
    data: repositories,
    isLoading,
    error,
    refetch,
  } = trpc.getRepositories.useQuery(
    { limit: repoLimit, offset: 0 },
    {
      enabled: true,
      refetchOnWindowFocus: false,
    }
  );

  const loadMore = useCallback(() => {
    setRepoLimit((prev) => prev + 50);
  }, []);

  const { data: groups = [], refetch: refetchGroups } = trpc.groups.getAll.useQuery(undefined, {
    enabled: true,
    refetchOnWindowFocus: false,
  });

  const { data: ungroupedRepos = [], refetch: refetchUngrouped } =
    trpc.groupsQuery.getUngroupedRepos.useQuery(undefined, {
      enabled: true,
      refetchOnWindowFocus: false,
    });

  const selectedGroupQueryInput =
    selectedGroupId !== null ? { groupId: selectedGroupId } : skipToken;

  const {
    data: selectedGroup,
    isLoading: isSelectedGroupLoading,
    error: selectedGroupError,
    refetch: refetchSelectedGroup,
  } = trpc.groups.getWithMembers.useQuery(selectedGroupQueryInput, {
    refetchOnWindowFocus: false,
  });

  const createGroupMutation = trpc.groups.create.useMutation({
    onSuccess: async () => {
      await refetchGroups();
      setShowCreateGroupDialog(false);
    },
  });

  const uniqueRepositories = useMemo<Repository[]>(
    () => dedupeRepositories((repositories ?? []).map(normalizeRepository)),
    [repositories]
  );

  const uniqueUngroupedRepos = useMemo<Repository[]>(
    () => dedupeRepositories(ungroupedRepos.map(normalizeRepository)),
    [ungroupedRepos]
  );

  const selectedGroupRepositories = useMemo<Repository[]>(() => {
    if (!selectedGroup) {
      return [];
    }

    return dedupeRepositories(
      selectedGroup.members.flatMap((member) =>
        member.repository ? [normalizeRepository(member.repository)] : []
      )
    );
  }, [selectedGroup]);

  const displayedRepositories = useMemo<Repository[]>(() => {
    if (selectedGroupId !== null) {
      return selectedGroupRepositories;
    }

    if (isUngroupedSelected) {
      return uniqueUngroupedRepos;
    }

    return uniqueRepositories;
  }, [
    isUngroupedSelected,
    selectedGroupId,
    selectedGroupRepositories,
    uniqueRepositories,
    uniqueUngroupedRepos,
  ]);

  const sortedRepositories = useMemo(
    () => sortRepositories(displayedRepositories, sortBy, order),
    [displayedRepositories, sortBy, order]
  );

  const currentGroupName =
    selectedGroupId !== null
      ? (selectedGroup?.name ??
        groups.find((group) => group.id === selectedGroupId)?.name ??
        '\u5206\u7ec4\u4ed3\u5e93')
      : isUngroupedSelected
        ? '未分组仓库'
        : '\u5168\u90e8\u4ed3\u5e93';

  const totalRepoCount = uniqueRepositories.length;
  const ungroupedRepoCount = uniqueUngroupedRepos.length;
  const pageError = error ?? selectedGroupError;
  const isListLoading = isLoading || (selectedGroupId !== null && isSelectedGroupLoading);

  const handleViewDetails = (id: number) => {
    router.push(`/repository/${id}`);
  };

  const handleCollected = () => {
    void Promise.all([
      refetch(),
      refetchGroups(),
      refetchUngrouped(),
      selectedGroupId !== null ? refetchSelectedGroup() : Promise.resolve(),
    ]);
  };

  const handleSelectFromFollowing = (fullName: string) => {
    setActivePanel('collect');
    (window as { __pendingCollectRepo?: string }).__pendingCollectRepo = fullName;
  };

  const handleRetry = () => {
    void Promise.all([
      refetch(),
      selectedGroupId !== null ? refetchSelectedGroup() : Promise.resolve(),
    ]);
  };

  const handleSelectAll = () => {
    setSelectedGroupId(null);
    setIsUngroupedSelected(false);
  };

  const handleSelectUngrouped = () => {
    setSelectedGroupId(null);
    setIsUngroupedSelected(true);
  };

  const handleSelectGroup = (group: RepositoryGroup) => {
    setSelectedGroupId(group.id);
    setIsUngroupedSelected(false);
  };

  const handleCreateGroup = (input: CreateGroupInput) => {
    createGroupMutation.mutate(input);
  };

  return (
    <main className="min-h-screen">
      <AnimatedBackground />

      <div className="container mx-auto max-w-7xl px-4 py-6 sm:py-8">
        <header className="command-page-header mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="command-kicker">仓库控制台</p>
            <h1 className="text-2xl font-semibold tracking-tight">仓库工作区</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              浏览已采集仓库，按分组筛选并进入详情或分析。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              aria-controls="home-action-panel"
              aria-expanded={activePanel === 'collect'}
              onClick={() =>
                setActivePanel((current) => (current === 'collect' ? null : 'collect'))
              }
            >
              <Plus />
              采集仓库
            </Button>
            <Button
              variant="outline"
              aria-controls="home-action-panel"
              aria-expanded={activePanel === 'following'}
              onClick={() =>
                setActivePanel((current) => (current === 'following' ? null : 'following'))
              }
            >
              <Star />
              我的关注
            </Button>
          </div>
        </header>

        {activePanel && (
          <section
            id="home-action-panel"
            aria-label={activePanel === 'collect' ? '采集仓库' : '我的关注'}
            className="command-surface relative mb-8 p-4 sm:p-6"
          >
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute right-2 top-2"
              onClick={() => setActivePanel(null)}
              aria-label="关闭面板"
            >
              <X />
            </Button>
            {activePanel === 'collect' ? (
              <CollectForm onCollected={handleCollected} />
            ) : (
              <FollowingList onSelectRepo={handleSelectFromFollowing} />
            )}
          </section>
        )}

        <section aria-labelledby="repository-list-heading" className="min-w-0">
          <GroupTabs
            groups={groups}
            selectedGroupId={selectedGroupId}
            isUngroupedSelected={isUngroupedSelected}
            totalRepoCount={totalRepoCount}
            ungroupedRepoCount={ungroupedRepoCount}
            onSelectAll={handleSelectAll}
            onSelectUngrouped={handleSelectUngrouped}
            onSelectGroup={handleSelectGroup}
            onCreateGroup={() => setShowCreateGroupDialog(true)}
          />

          <div className="command-toolbar my-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="repository-list-heading" className="text-lg font-semibold">
                {currentGroupName}
              </h2>
              <p className="text-sm text-muted-foreground">
                当前显示 {sortedRepositories.length} 个仓库
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SortControl
                value={sortBy}
                order={order}
                onSortChange={setSortBy}
                onOrderToggle={toggleOrder}
              />
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
            </div>
          </div>

          {isListLoading && (
            <div aria-busy="true" aria-label="正在加载仓库" className="space-y-2">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-28 animate-pulse rounded-lg border bg-muted/50" />
              ))}
            </div>
          )}

          {pageError && (
            <div
              role="alert"
              className="command-surface border-destructive/30 bg-destructive/5 px-4 py-6 text-center"
            >
              <p className="font-medium text-destructive">仓库列表加载失败</p>
              <p className="mt-1 text-sm text-muted-foreground">请检查 API 与数据库连接后重试。</p>
              <details className="mx-auto mt-3 max-w-3xl text-left text-xs text-muted-foreground">
                <summary className="cursor-pointer text-center">查看错误详情</summary>
                <p className="mt-2 break-words rounded bg-background/70 p-3">{pageError.message}</p>
              </details>
              <Button variant="outline" className="mt-4" onClick={handleRetry}>
                <RefreshCw />
                重新加载
              </Button>
            </div>
          )}

          {!isListLoading && !pageError && sortedRepositories.length === 0 && (
            <div className="command-surface border-dashed px-4 py-10 text-center">
              <p className="font-medium">当前范围内还没有仓库</p>
              <p className="mt-1 text-sm text-muted-foreground">
                采集一个 GitHub 仓库，或切换到其他分组查看。
              </p>
              <Button className="mt-4" onClick={() => setActivePanel('collect')}>
                <Plus />
                采集仓库
              </Button>
            </div>
          )}

          {!isListLoading && !pageError && sortedRepositories.length > 0 && (
            <>
              <div
                className={
                  viewMode === 'card' ? 'grid grid-cols-1 gap-4 md:grid-cols-2' : 'grid gap-3'
                }
              >
                {sortedRepositories.map((repo) => (
                  <RepositoryCard
                    key={repo.id}
                    repository={repo}
                    onViewDetails={handleViewDetails}
                    viewMode={viewMode}
                  />
                ))}
              </div>
              {selectedGroupId === null &&
                !isUngroupedSelected &&
                (repositories?.length ?? 0) >= repoLimit && (
                  <div className="mt-6 text-center">
                    <Button variant="outline" onClick={loadMore}>
                      加载更多
                    </Button>
                  </div>
                )}
            </>
          )}
        </section>
      </div>

      <CreateGroupDialog
        open={showCreateGroupDialog}
        onOpenChange={setShowCreateGroupDialog}
        onCreate={handleCreateGroup}
      />
    </main>
  );
}
