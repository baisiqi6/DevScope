/**
 * @package @devscope/web/app/groups
 * @description 分组管理页面
 *
 * 专门用于管理仓库分组的页面，包含分组创建、编辑、搜索等功能。
 */

"use client";

import { type DragEvent, useMemo, useRef, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Navigation } from "@/components/navigation";
import { AnimatedBackground } from "@/components/animated-background";
import { GroupTabs } from "@/components/group-tabs";
import { CreateGroupDialog } from "@/components/create-group-dialog";
import { UngroupedSidebar } from "@/components/ungrouped-sidebar-v2";
import { RepositoryCard } from "@/components/repository-card";
import { SortControl, sortRepositories, useSortPreferences } from "@/components/sort-control";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  Settings,
  Trash2,
  Edit,
  FolderOpen,
  Plus,
  Search,
  X
} from "lucide-react";
import type { Repository, RepositoryGroup } from "@devscope/shared";
import { getGroupIcon, getGroupColor } from "@/lib/group-config";

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
      typeof repo.lastFetchedAt === "string"
        ? repo.lastFetchedAt
        : repo.lastFetchedAt?.toISOString(),
    starredAt:
      typeof repo.starredAt === "string"
        ? repo.starredAt
        : repo.starredAt?.toISOString(),
    note: repo.note ?? undefined,
  };
}

export default function GroupsManagementPage() {
  // 分组相关状态
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [draggingRepo, setDraggingRepo] = useState<Repository | null>(null);
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);
  const [isDropZoneSuccess, setIsDropZoneSuccess] = useState(false);
  const dropEnterCounterRef = useRef(0);
  const { sortBy, order, setSortBy, toggleOrder } = useSortPreferences("stars", "desc");

  // 获取分组列表
  const { data: groups = [], refetch: refetchGroups } = trpc.groups.getAll.useQuery(
    undefined,
    {
      enabled: true,
      refetchOnWindowFocus: false,
    }
  );

  // 获取未分组仓库
  const { data: ungroupedRepos = [], refetch: refetchUngroupedRepos } = trpc.groupsQuery.getUngroupedRepos.useQuery(
    undefined,
    {
      enabled: true,
      refetchOnWindowFocus: false,
    }
  );

  // 获取所有仓库
  const { data: allRepositories = [] } = trpc.getRepositories.useQuery(
    undefined,
    {
      enabled: true,
      refetchOnWindowFocus: false,
    }
  );

  const selectedGroupQueryInput =
    selectedGroupId !== null ? { groupId: selectedGroupId } : skipToken;

  const { data: selectedGroup, refetch: refetchSelectedGroup } = trpc.groups.getWithMembers.useQuery(
    selectedGroupQueryInput,
    {
      refetchOnWindowFocus: false,
    }
  );

  // 创建分组 mutation
  const createGroupMutation = trpc.groups.create.useMutation({
    onSuccess: () => {
      refetchGroups();
      setShowCreateGroupDialog(false);
    },
  });

  // 删除分组 mutation
  const deleteGroupMutation = trpc.groups.delete.useMutation({
    onSuccess: () => {
      refetchGroups();
      if (selectedGroupId === editingGroupId) {
        setSelectedGroupId(null);
      }
      setEditingGroupId(null);
    },
  });

  // 计算显示的仓库
  const displayRepos = selectedGroupId !== null
    ? [] // TODO: 获取分组内的仓库
    : allRepositories;

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

  void displayRepos;

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
      selectedGroup.members
        .map((member: { repository: Parameters<typeof normalizeRepository>[0] | null }) => member.repository)
        .filter(
          (
            repo: Parameters<typeof normalizeRepository>[0] | null
          ): repo is Parameters<typeof normalizeRepository>[0] => Boolean(repo)
        )
        .map(normalizeRepository)
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
    event.dataTransfer.dropEffect = "move";

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

  const handleDropToSelectedGroup = async (
    event: DragEvent<HTMLDivElement>
  ) => {
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
      console.error("Failed to add repo to group:", error);
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
    window.open(`/repository/${id}`, '_blank');
  };

  const handleCreateGroup = (input: { name: string; color?: string; icon?: string; description?: string }) => {
    createGroupMutation.mutate(input);
  };

  const handleDeleteGroup = (groupId: number, groupName: string) => {
    if (!confirm(`确定要删除分组"${groupName}"吗？此操作不会删除仓库，只会删除分组。`)) {
      return;
    }
    deleteGroupMutation.mutate({ groupId });
  };

  const handleStartEditing = (groupId: number) => {
    setEditingGroupId(groupId);
  };

  const handleCancelEditing = () => {
    setEditingGroupId(null);
  };

  // 过滤分组
  const filteredGroups = searchQuery
    ? groups.filter((g: RepositoryGroup) =>
        g.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : groups;

  return (
    <main className="min-h-screen">
      {/* 动画背景 */}
      <AnimatedBackground />

      {/* 页面内容容器 - 添加动态右边距 */}
      <motion.div
        animate={{
          paddingRight: isSidebarOpen ? 380 : 0,
        }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >

      {/* Header */}
      <header className="border-b border-slate-200/60 bg-white/70 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <motion.h1
            className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            DevScope
          </motion.h1>
          <Navigation />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* 顶部工具栏 */}
        <motion.div
          className="mb-6 flex items-center justify-between"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* 搜索框 */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索分组..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* 创建分组按钮 */}
          <Button
            onClick={() => setShowCreateGroupDialog(true)}
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            新建分组
          </Button>
        </motion.div>

        {/* 统计卡片 */}
        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card className="bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">分组总数</p>
                  <p className="text-2xl font-bold text-purple-700">{groups.length}</p>
                </div>
                <FolderOpen className="h-8 w-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">已分组仓库</p>
                  <p className="text-2xl font-bold text-blue-700">
                    {groupedRepoCount}
                  </p>
                </div>
                <FolderOpen className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-amber-50 to-orange-50 border-orange-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">未分组仓库</p>
                  <p className="text-2xl font-bold text-amber-700">{ungroupedRepoCount}</p>
                </div>
                <FolderOpen className="h-8 w-8 text-amber-500" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* 分组标签栏 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <GroupTabs
            groups={groups}
            selectedGroupId={selectedGroupId}
            totalRepoCount={totalRepoCount}
            onSelectAll={handleSelectAll}
            onSelectGroup={handleSelectGroup}
            onCreateGroup={() => setShowCreateGroupDialog(true)}
          />
        </motion.div>

        {/* 分组列表 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{
            opacity: 1,
            y: 0,
            scale: isDropZoneActive ? 1.01 : 1,
          }}
          transition={{ duration: 0.3, delay: 0.25 }}
          onDragEnter={handleDropZoneDragEnter}
          onDragOver={handleDropZoneDragOver}
          onDragLeave={handleDropZoneDragLeave}
          onDrop={handleDropToSelectedGroup}
          className={`mb-8 mt-6 rounded-3xl border p-4 transition-all duration-300 ${
            selectedGroupId !== null && isDropZoneActive
              ? "border-amber-400 bg-amber-50/80 shadow-[0_18px_48px_rgba(251,146,60,0.18)]"
              : selectedGroupId !== null && isDropZoneSuccess
                ? "border-emerald-400 bg-emerald-50/80 shadow-[0_18px_48px_rgba(16,185,129,0.16)]"
                : draggingRepo && selectedGroupId !== null
                  ? "border-amber-200 bg-white/90 shadow-[0_12px_36px_rgba(251,146,60,0.08)]"
                  : "border-transparent"
          }`}
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                {selectedGroupId !== null ? selectedGroup?.name ?? "分组仓库" : "全部仓库"}
              </h2>
              <p className="text-sm text-slate-500">
                当前显示 {sortedDisplayRepos.length} 个唯一仓库
              </p>
              {selectedGroupId !== null && draggingRepo && (
                <p className={`mt-2 text-sm transition-colors ${
                  isDropZoneActive ? "text-amber-700" : "text-slate-500"
                }`}>
                  {isDropZoneActive
                    ? `释放后把 ${draggingRepo.owner}/${draggingRepo.name} 加入当前分组`
                    : `把 ${draggingRepo.owner}/${draggingRepo.name} 拖进这个区域即可加入当前分组`}
                </p>
              )}
              {selectedGroupId === null && draggingRepo && (
                <p className="mt-2 text-sm text-slate-500">
                  先选择一个分组，再把右侧未分组仓库拖进来
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

          {sortedDisplayRepos.length === 0 ? (
            <Card className="border-dashed border-slate-300 bg-white/70">
              <CardContent className="py-10 text-center text-slate-500">
                {selectedGroupId !== null ? "这个分组下还没有仓库" : "还没有可展示的仓库"}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {sortedDisplayRepos.map((repo) => (
                <RepositoryCard
                  key={repo.id}
                  repository={repo}
                  onViewDetails={handleViewDetails}
                />
              ))}
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="space-y-4"
        >
          {filteredGroups.length === 0 ? (
            <Card className="bg-gray-50 border-gray-200">
              <CardContent className="py-12 text-center">
                <FolderOpen className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-500 mb-2">
                  {searchQuery ? "未找到匹配的分组" : "还没有创建任何分组"}
                </p>
                {!searchQuery && (
                  <p className="text-sm text-gray-400">
                    点击上方「新建分组」按钮开始创建
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredGroups.map((group: RepositoryGroup) => {
                const colorConfig = getGroupColor(group.color);
                const iconConfig = getGroupIcon(group.icon);
                const IconComponent = iconConfig.icon;
                const isEditing = editingGroupId === group.id;

                return (
                  <Card
                    key={group.id}
                    className={`border-2 transition-all hover:shadow-md ${selectedGroupId === group.id ? `${colorConfig.border} ${colorConfig.bg} shadow-md` : "border-gray-200 hover:border-gray-300"}`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2 flex-1">
                          {IconComponent && (
                            <div className={`p-2 rounded-lg ${colorConfig.solidBg} text-white`}>
                              <IconComponent className="h-4 w-4" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <CardTitle className="truncate">{group.name}</CardTitle>
                            {group.description && (
                              <p className="text-xs text-gray-500 truncate mt-1">
                                {group.description}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex items-center gap-1">
                          {isEditing ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleCancelEditing}
                                className="h-8 w-8 p-0"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleStartEditing(group.id)}
                                className="h-8 w-8 p-0"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteGroup(group.id, group.name)}
                                className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent>
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-4 text-gray-600">
                          <div className="flex items-center gap-1">
                            <Settings className="h-3 w-3" />
                            <span>{group.repoCount ?? 0} 个仓库</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className={colorConfig.text}>
                              {group.color}
                            </Badge>
                          </div>
                        </div>

                        {selectedGroupId !== group.id && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSelectGroup(group)}
                            className="shrink-0"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            添加仓库
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* 创建分组对话框 */}
        <CreateGroupDialog
          open={showCreateGroupDialog}
          onOpenChange={setShowCreateGroupDialog}
          onCreate={handleCreateGroup}
        />
      </div>

      {/* 未分组仓库侧拉栏 */}
      <UngroupedSidebar
        ungroupedRepos={uniqueUngroupedRepos}
        onViewDetails={handleViewDetails}
        isOpen={isSidebarOpen}
        onOpenChange={setIsSidebarOpen}
        draggingRepoId={draggingRepo?.id ?? null}
        onRepoDragStart={handleRepoDragStart}
        onRepoDragEnd={handleRepoDragEnd}
      />
      </motion.div>
    </main>
  );
}
