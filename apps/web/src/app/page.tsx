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
import { GroupTabs } from "@/components/group-tabs";
import { CreateGroupDialog } from "@/components/create-group-dialog";
import { Button } from "@/components/ui/button";
import { AnimatedBackground, FadeInItem } from "@/components/animated-background";
import { motion } from "framer-motion";
import { useMemo } from "react";
import type { RepositoryGroup } from "@devscope/shared";

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"collect" | "following">("collect");
  const [viewMode, setViewMode] = useViewMode("card");
  const { sortBy, order, setSortBy, toggleOrder } = useSortPreferences("stars", "desc");

  // 分组相关状态
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [isUngroupedSelected, setIsUngroupedSelected] = useState(false);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);

  // 获取仓库列表
  const { data: repositories, isLoading, error, refetch } = trpc.getRepositories.useQuery(
    undefined,
    {
      enabled: true,
      refetchOnWindowFocus: false,
    }
  );

  // 获取分组列表
  const { data: groups = [], refetch: refetchGroups } = trpc.groups.getAll.useQuery(
    undefined,
    {
      enabled: true,
      refetchOnWindowFocus: false,
    }
  );

  // 获取未分组仓库
  const { data: ungroupedRepos = [], refetch: refetchUngrouped } = trpc.groupsQuery.getUngroupedRepos.useQuery(
    undefined,
    {
      enabled: isUngroupedSelected,
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

  // 应用排序和分组过滤
  const sortedRepositories = useMemo(() => {
    let repos = repositories || [];

    // 根据选中的分组过滤
    if (selectedGroupId !== null) {
      // 显示选定分组的仓库
      const selectedGroup = groups.find((g) => g.id === selectedGroupId);
      if (selectedGroup) {
        // 这里需要调用 API 获取分组内的仓库
        // 暂时返回所有仓库，后续需要添加 API 调用
        repos = repos; // TODO: 实现分组内仓库过滤
      }
    } else if (isUngroupedSelected) {
      // 显示未分组的仓库
      const ungroupedIds = new Set(ungroupedRepos.map((r) => r.id));
      repos = repos.filter((r) => ungroupedIds.has(r.id));
    }
    // selectedGroupId === null 表示显示全部仓库

    // 应用排序
    return sortRepositories(repos, sortBy, order);
  }, [repositories, ungroupedRepos, groups, selectedGroupId, isUngroupedSelected, sortBy, order]);

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

  // 分组相关处理函数
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

  const handleCreateGroup = (input: { name: string; color?: string; icon?: string; description?: string }) => {
    createGroupMutation.mutate(input);
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
            {/* 分组标签栏 */}
            <GroupTabs
              groups={groups}
              selectedGroupId={selectedGroupId}
              isUngroupedSelected={isUngroupedSelected}
              totalRepoCount={repositories?.length ?? 0}
              ungroupedRepoCount={ungroupedRepos.length}
              onSelectAll={handleSelectAll}
              onSelectUngrouped={handleSelectUngrouped}
              onSelectGroup={handleSelectGroup}
              onCreateGroup={() => setShowCreateGroupDialog(true)}
            />

            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {selectedGroupId !== null
                  ? groups.find((g) => g.id === selectedGroupId)?.name
                  : isUngroupedSelected
                  ? "未分组仓库"
                  : "全部仓库"
                } {repositories && `(${repositories.length})`}
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

      {/* 创建分组对话框 */}
      <CreateGroupDialog
        open={showCreateGroupDialog}
        onOpenChange={setShowCreateGroupDialog}
        onCreate={handleCreateGroup}
      />
    </main>
  );
}
