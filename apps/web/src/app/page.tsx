"use client";

import { useMemo, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { Repository, RepositoryGroup } from "@devscope/shared";
import { trpc } from "@/lib/trpc";
import { RepositoryCard } from "@/components/repository-card";
import { CollectForm } from "@/components/collect-form";
import { FollowingList } from "@/components/following-list";
import { Navigation } from "@/components/navigation";
import { ViewModeToggle, useViewMode } from "@/components/view-toggle";
import {
  SortControl,
  sortRepositories,
  useSortPreferences,
} from "@/components/sort-control";
import { GroupTabs } from "@/components/group-tabs";
import { CreateGroupDialog } from "@/components/create-group-dialog";
import { Button } from "@/components/ui/button";
import {
  AnimatedBackground,
  FadeInItem,
} from "@/components/animated-background";

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
  };
}

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"collect" | "following">(
    "collect"
  );
  const [viewMode, setViewMode] = useViewMode("card");
  const { sortBy, order, setSortBy, toggleOrder } = useSortPreferences(
    "stars",
    "desc"
  );
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [isUngroupedSelected, setIsUngroupedSelected] = useState(false);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);

  const {
    data: repositories,
    isLoading,
    error,
    refetch,
  } = trpc.getRepositories.useQuery(undefined, {
    enabled: true,
    refetchOnWindowFocus: false,
  });

  const { data: groups = [], refetch: refetchGroups } =
    trpc.groups.getAll.useQuery(undefined, {
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
      selectedGroup.members
        .map(
          (member: {
            repository: Parameters<typeof normalizeRepository>[0] | null;
          }) => member.repository
        )
        .filter(
          (
            repo: Parameters<typeof normalizeRepository>[0] | null
          ): repo is Parameters<typeof normalizeRepository>[0] => Boolean(repo)
        )
        .map(normalizeRepository)
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
      ? selectedGroup?.name ??
        groups.find((group: RepositoryGroup) => group.id === selectedGroupId)?.name ??
        "\u5206\u7ec4\u4ed3\u5e93"
      : isUngroupedSelected
        ? "未分组仓库"
        : "\u5168\u90e8\u4ed3\u5e93";

  const totalRepoCount = uniqueRepositories.length;
  const ungroupedRepoCount = uniqueUngroupedRepos.length;
  const pageError = error ?? selectedGroupError;
  const isListLoading =
    isLoading || (selectedGroupId !== null && isSelectedGroupLoading);

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
    setActiveTab("collect");
    (window as { __pendingCollectRepo?: string }).__pendingCollectRepo =
      fullName;
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

  const handleCreateGroup = (input: {
    name: string;
    color?: string;
    icon?: string;
    description?: string;
  }) => {
    createGroupMutation.mutate(input);
  };

  return (
    <main className="min-h-screen">
      <AnimatedBackground />

      <header className="sticky top-0 z-50 border-b border-slate-200/60 bg-white/70 backdrop-blur-md">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <motion.h1
            className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-2xl font-bold text-transparent"
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
          <div className="lg:col-span-1">
            <div className="mb-4 flex gap-2">
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

            {activeTab === "collect" ? (
              <CollectForm onCollected={handleCollected} />
            ) : (
              <FollowingList onSelectRepo={handleSelectFromFollowing} />
            )}
          </div>

          <div className="lg:col-span-2">
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

            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {currentGroupName} ({sortedRepositories.length})
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

            {isListLoading && (
              <div className="py-8 text-center text-muted-foreground">
                鍔犺浇涓?..
              </div>
            )}

            {pageError && (
              <div className="py-8 text-center text-red-500">
                鍔犺浇澶辫触: {pageError.message}
              </div>
            )}

            {!isListLoading && !pageError && sortedRepositories.length === 0 && (
              <div className="py-8 text-center text-muted-foreground">
                <p className="mb-4">
                  {"\u8fd8\u6ca1\u6709\u91c7\u96c6\u5230\u53ef\u5c55\u793a\u7684\u4ed3\u5e93\u6570\u636e"}
                </p>
                <p className="text-sm">
                  {"\u53ef\u4ee5\u5148\u5728\u5de6\u4fa7\u8f93\u5165\u4ed3\u5e93\u5730\u5740\u5f00\u59cb\u91c7\u96c6"}
                </p>
              </div>
            )}

            {!isListLoading && !pageError && sortedRepositories.length > 0 && (
              <div
                className={
                  viewMode === "card"
                    ? "grid grid-cols-1 gap-4 md:grid-cols-2"
                    : "grid gap-3"
                }
              >
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

      <CreateGroupDialog
        open={showCreateGroupDialog}
        onOpenChange={setShowCreateGroupDialog}
        onCreate={handleCreateGroup}
      />
    </main>
  );
}


