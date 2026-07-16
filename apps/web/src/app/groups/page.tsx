/**
 * @package @devscope/web/app/groups
 * @description 分组管理页面
 *
 * 专门用于管理仓库分组的页面，包含分组创建、编辑、搜索等功能。
 */

'use client';

import { type DragEvent, useMemo, useRef, useState } from 'react';
import { skipToken } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { AnimatedBackground } from '@/components/animated-background';
import { GroupTabs } from '@/components/group-tabs';
import { CreateGroupDialog } from '@/components/create-group-dialog';
import { UngroupedSidebar } from '@/components/ungrouped-sidebar-v2';
import { RepositoryCard } from '@/components/repository-card';
import { SortControl, sortRepositories, useSortPreferences } from '@/components/sort-control';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Check, Trash2, Edit, FolderOpen, Plus, RefreshCw, Search, X } from 'lucide-react';
import type { CreateGroupInput, Repository, RepositoryGroup } from '@devscope/shared';
import { getGroupIcon, getGroupColor } from '@/lib/group-config';

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

export default function GroupsManagementPage() {
  // 分组相关状态
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [editingGroupDescription, setEditingGroupDescription] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [draggingRepo, setDraggingRepo] = useState<Repository | null>(null);
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);
  const [isDropZoneSuccess, setIsDropZoneSuccess] = useState(false);
  const dropEnterCounterRef = useRef(0);
  const { sortBy, order, setSortBy, toggleOrder } = useSortPreferences('stars', 'desc');

  // 获取分组列表
  const {
    data: groups = [],
    isLoading: isGroupsLoading,
    error: groupsError,
    refetch: refetchGroups,
  } = trpc.groups.getAll.useQuery(undefined, {
    enabled: true,
    refetchOnWindowFocus: false,
  });

  // 获取未分组仓库
  const {
    data: ungroupedRepos = [],
    error: ungroupedReposError,
    refetch: refetchUngroupedRepos,
  } = trpc.groupsQuery.getUngroupedRepos.useQuery(undefined, {
    enabled: true,
    refetchOnWindowFocus: false,
  });

  // 获取所有仓库
  const {
    data: allRepositories = [],
    isLoading: isRepositoriesLoading,
    error: repositoriesError,
    refetch: refetchRepositories,
  } = trpc.getRepositories.useQuery(undefined, {
    enabled: true,
    refetchOnWindowFocus: false,
  });

  const selectedGroupQueryInput =
    selectedGroupId !== null ? { groupId: selectedGroupId } : skipToken;

  const { data: selectedGroup, refetch: refetchSelectedGroup } =
    trpc.groups.getWithMembers.useQuery(selectedGroupQueryInput, {
      refetchOnWindowFocus: false,
    });

  // 创建分组 mutation
  const createGroupMutation = trpc.groups.create.useMutation({
    onSuccess: () => {
      refetchGroups();
      setShowCreateGroupDialog(false);
    },
  });

  // 删除分组 mutation
  const deleteGroupMutation = trpc.groups.delete.useMutation({
    onSuccess: (_, variables) => {
      refetchGroups();
      if (selectedGroupId === variables.groupId) {
        setSelectedGroupId(null);
      }
      if (editingGroupId === variables.groupId) {
        setEditingGroupId(null);
      }
    },
  });

  const updateGroupMutation = trpc.groups.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        refetchGroups(),
        selectedGroupId !== null ? refetchSelectedGroup() : Promise.resolve(),
      ]);
      setEditingGroupId(null);
    },
  });

  // 处理函数
  const addGroupMemberMutation = trpc.groupMembers.add.useMutation({
    onSuccess: async () => {
      await Promise.all([
        refetchGroups(),
        refetchUngroupedRepos(),
        selectedGroupId !== null ? refetchSelectedGroup() : Promise.resolve(),
      ]);
    },
  });

  const uniqueAllRepositories = useMemo<Repository[]>(
    () => dedupeRepositories(allRepositories.map(normalizeRepository)),
    [allRepositories]
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

  const resolvedDisplayRepos: Repository[] =
    selectedGroupId !== null ? selectedGroupRepositories : uniqueAllRepositories;
  const sortedDisplayRepos = useMemo(
    () => sortRepositories(resolvedDisplayRepos, sortBy, order),
    [resolvedDisplayRepos, sortBy, order]
  );
  const totalRepoCount = uniqueAllRepositories.length;
  const ungroupedRepoCount = uniqueUngroupedRepos.length;
  const groupedRepoCount = Math.max(0, totalRepoCount - ungroupedRepoCount);

  const resetDropZone = () => {
    dropEnterCounterRef.current = 0;
    setIsDropZoneActive(false);
  };

  const handleRepoDragStart = (repo: Repository) => {
    setDraggingRepo(repo);
    setIsSidebarOpen(true);
    setIsDropZoneSuccess(false);
  };

  const handleRepoDragEnd = () => {
    setDraggingRepo(null);
    resetDropZone();
  };

  const handleDropZoneDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingRepo || selectedGroupId === null) {
      return;
    }

    event.preventDefault();
    dropEnterCounterRef.current += 1;
    setIsDropZoneActive(true);
  };

  const handleDropZoneDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingRepo || selectedGroupId === null) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (!isDropZoneActive) {
      setIsDropZoneActive(true);
    }
  };

  const handleDropZoneDragLeave = () => {
    if (!draggingRepo || selectedGroupId === null) {
      return;
    }

    dropEnterCounterRef.current = Math.max(0, dropEnterCounterRef.current - 1);
    if (dropEnterCounterRef.current === 0) {
      setIsDropZoneActive(false);
    }
  };

  const handleDropToSelectedGroup = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (!draggingRepo || selectedGroupId === null || addGroupMemberMutation.isPending) {
      resetDropZone();
      return;
    }

    try {
      await addGroupMemberMutation.mutateAsync({
        groupId: selectedGroupId,
        repoId: draggingRepo.id,
      });

      setIsDropZoneSuccess(true);
      window.setTimeout(() => {
        setIsDropZoneSuccess(false);
      }, 800);
    } catch (error) {
      console.error('Failed to add repo to group:', error);
    } finally {
      setDraggingRepo(null);
      resetDropZone();
    }
  };

  const handleSelectAll = () => {
    setSelectedGroupId(null);
  };

  const handleSelectGroup = (group: RepositoryGroup) => {
    setSelectedGroupId(group.id);
  };

  const handleViewDetails = (id: number) => {
    window.location.href = `/repository/${id}`;
  };

  const handleCreateGroup = (input: CreateGroupInput) => {
    createGroupMutation.mutate(input);
  };

  const handleDeleteGroup = (groupId: number, groupName: string) => {
    if (!confirm(`确定要删除分组"${groupName}"吗？此操作不会删除仓库，只会删除分组。`)) {
      return;
    }
    deleteGroupMutation.mutate({ groupId });
  };

  const handleStartEditing = (group: RepositoryGroup) => {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
    setEditingGroupDescription(group.description ?? '');
  };

  const handleCancelEditing = () => {
    setEditingGroupId(null);
    setEditingGroupName('');
    setEditingGroupDescription('');
  };

  const handleSaveEditing = () => {
    if (editingGroupId === null || !editingGroupName.trim()) {
      return;
    }

    updateGroupMutation.mutate({
      groupId: editingGroupId,
      name: editingGroupName.trim(),
      description: editingGroupDescription.trim(),
    });
  };

  const handleRetry = () => {
    void Promise.all([
      refetchGroups(),
      refetchUngroupedRepos(),
      refetchRepositories(),
      selectedGroupId !== null ? refetchSelectedGroup() : Promise.resolve(),
    ]);
  };

  // 过滤分组
  const filteredGroups = searchQuery
    ? groups.filter((g) => g.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : groups;
  const pageError = groupsError ?? ungroupedReposError ?? repositoriesError;
  const isPageLoading = isGroupsLoading || isRepositoriesLoading;

  return (
    <main className="min-h-screen">
      <AnimatedBackground />

      <div className={isSidebarOpen ? 'lg:pr-[380px]' : undefined}>
        <div className="container mx-auto max-w-7xl px-4 py-6 sm:py-8">
          <header className="command-page-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="command-kicker">集合编排</p>
              <h1 className="text-2xl font-semibold tracking-tight">分组管理</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                整理仓库集合，选择分组后可从右侧拖入未分组仓库。
              </p>
            </div>
            <Button onClick={() => setShowCreateGroupDialog(true)}>
              <Plus />
              新建分组
            </Button>
          </header>

          <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-md">
              <label htmlFor="group-search" className="sr-only">
                搜索分组
              </label>
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="group-search"
                type="search"
                placeholder="搜索分组"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9 pr-10"
              />
              {searchQuery && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="清空分组搜索"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                >
                  <X />
                </Button>
              )}
            </div>

            <dl className="telemetry-strip grid grid-cols-3 text-sm">
              {[
                ['分组', groups.length],
                ['已分组', groupedRepoCount],
                ['未分组', ungroupedRepoCount],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 border-r px-4 py-2.5 last:border-r-0">
                  <dt className="truncate text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {pageError && (
            <div
              role="alert"
              className="mt-6 flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-medium text-destructive">分组数据加载失败</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  请确认本地 API 与数据库已启动，然后重试。
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <RefreshCw />
                重新加载
              </Button>
            </div>
          )}

          <div className="mt-6 border-b pb-4">
            <GroupTabs
              groups={groups}
              selectedGroupId={selectedGroupId}
              totalRepoCount={totalRepoCount}
              onSelectAll={handleSelectAll}
              onSelectGroup={handleSelectGroup}
              onCreateGroup={() => setShowCreateGroupDialog(true)}
            />
          </div>

          <section
            aria-labelledby="repository-section-title"
            onDragEnter={handleDropZoneDragEnter}
            onDragOver={handleDropZoneDragOver}
            onDragLeave={handleDropZoneDragLeave}
            onDrop={handleDropToSelectedGroup}
            className={`mt-6 rounded-lg border p-4 transition-colors duration-200 sm:p-5 ${
              selectedGroupId !== null && isDropZoneActive
                ? 'border-primary bg-primary/5'
                : selectedGroupId !== null && isDropZoneSuccess
                  ? 'border-success/40 bg-success/10'
                  : draggingRepo && selectedGroupId !== null
                    ? 'border-primary/30 bg-card'
                    : 'border-transparent px-0 sm:px-0'
            }`}
          >
            <div className="mb-4 flex flex-col items-stretch gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="repository-section-title" className="text-lg font-semibold">
                  {selectedGroupId !== null ? (selectedGroup?.name ?? '分组仓库') : '全部仓库'}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  当前显示 {sortedDisplayRepos.length} 个唯一仓库
                </p>
                {draggingRepo && (
                  <p className="mt-2 text-sm text-primary" aria-live="polite">
                    {selectedGroupId === null
                      ? '先选择一个分组，再拖入未分组仓库。'
                      : isDropZoneActive
                        ? `释放后把 ${draggingRepo.owner}/${draggingRepo.name} 加入当前分组。`
                        : `把 ${draggingRepo.owner}/${draggingRepo.name} 拖入此区域。`}
                  </p>
                )}
              </div>
              <SortControl
                value={sortBy}
                order={order}
                onSortChange={setSortBy}
                onOrderToggle={toggleOrder}
              />
            </div>

            {isPageLoading ? (
              <div className="grid gap-3 md:grid-cols-2" aria-label="正在加载仓库">
                {[0, 1].map((item) => (
                  <div key={item} className="h-36 animate-pulse rounded-lg border bg-muted/40" />
                ))}
              </div>
            ) : sortedDisplayRepos.length === 0 ? (
              <Card className="border-dashed shadow-none">
                <CardContent className="py-10 text-center">
                  <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">
                    {selectedGroupId !== null ? '这个分组下还没有仓库' : '还没有可展示的仓库'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedGroupId !== null
                      ? '展开右侧未分组列表，把仓库拖到这里。'
                      : '先从仓库工作区采集仓库。'}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {sortedDisplayRepos.map((repo) => (
                  <RepositoryCard
                    key={repo.id}
                    repository={repo}
                    onViewDetails={handleViewDetails}
                  />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="group-settings-title" className="mt-10">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2 id="group-settings-title" className="text-lg font-semibold">
                  分组设置
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  修改分组名称与说明，或选择分组继续整理仓库。
                </p>
              </div>
              <span className="text-sm tabular-nums text-muted-foreground">
                {filteredGroups.length} 个
              </span>
            </div>

            {isGroupsLoading ? (
              <div className="h-24 animate-pulse rounded-lg border bg-muted/40" />
            ) : filteredGroups.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-10 text-center">
                <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">
                  {searchQuery ? '未找到匹配的分组' : '还没有创建分组'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {searchQuery ? '尝试缩短关键词。' : '创建分组后，可在这里维护名称和说明。'}
                </p>
              </div>
            ) : (
              <div className="command-surface divide-y overflow-hidden">
                {filteredGroups.map((group) => {
                  const colorConfig = getGroupColor(group.color);
                  const IconComponent = getGroupIcon(group.icon).icon;
                  const isEditing = editingGroupId === group.id;
                  const isSelected = selectedGroupId === group.id;

                  return (
                    <div
                      key={group.id}
                      className={`p-4 transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${colorConfig.bg} ${colorConfig.text}`}
                        >
                          <IconComponent className="h-4 w-4" />
                        </div>

                        {isEditing ? (
                          <div className="min-w-0 flex-1 space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div>
                                <label
                                  htmlFor={`group-name-${group.id}`}
                                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                                >
                                  分组名称
                                </label>
                                <Input
                                  id={`group-name-${group.id}`}
                                  value={editingGroupName}
                                  onChange={(event) => setEditingGroupName(event.target.value)}
                                  maxLength={50}
                                  autoFocus
                                />
                              </div>
                              <div>
                                <label
                                  htmlFor={`group-description-${group.id}`}
                                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                                >
                                  分组说明
                                </label>
                                <Input
                                  id={`group-description-${group.id}`}
                                  value={editingGroupDescription}
                                  onChange={(event) =>
                                    setEditingGroupDescription(event.target.value)
                                  }
                                  placeholder="可选"
                                />
                              </div>
                            </div>
                            {updateGroupMutation.error && (
                              <p role="alert" className="text-sm text-destructive">
                                保存失败：{updateGroupMutation.error.message}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                onClick={handleSaveEditing}
                                disabled={!editingGroupName.trim() || updateGroupMutation.isPending}
                              >
                                <Check />
                                {updateGroupMutation.isPending ? '保存中' : '保存'}
                              </Button>
                              <Button variant="ghost" size="sm" onClick={handleCancelEditing}>
                                取消
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-medium">{group.name}</h3>
                                {isSelected && (
                                  <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                    当前分组
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {group.description || '暂无说明'}
                              </p>
                              <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                                {group.repoCount ?? 0} 个仓库
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-1">
                              {!isSelected && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleSelectGroup(group)}
                                >
                                  选择分组
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleStartEditing(group)}
                                aria-label={`编辑分组 ${group.name}`}
                              >
                                <Edit />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteGroup(group.id, group.name)}
                                disabled={deleteGroupMutation.isPending}
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                aria-label={`删除分组 ${group.name}`}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <CreateGroupDialog
            open={showCreateGroupDialog}
            onOpenChange={setShowCreateGroupDialog}
            onCreate={handleCreateGroup}
          />
        </div>

        <UngroupedSidebar
          ungroupedRepos={uniqueUngroupedRepos}
          onViewDetails={handleViewDetails}
          isOpen={isSidebarOpen}
          onOpenChange={setIsSidebarOpen}
          draggingRepoId={draggingRepo?.id ?? null}
          onRepoDragStart={handleRepoDragStart}
          onRepoDragEnd={handleRepoDragEnd}
        />
      </div>
    </main>
  );
}
