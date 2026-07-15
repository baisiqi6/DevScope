"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FolderOpen } from "lucide-react";
import type { Repository } from "@devscope/shared";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { SortControl, type SortBy, type SortOrder, sortRepositories } from "./sort-control";

interface UngroupedSidebarProps {
  ungroupedRepos: Repository[];
  onViewDetails: (id: number) => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  draggingRepoId?: number | null;
  onRepoDragStart?: (repo: Repository) => void;
  onRepoDragEnd?: () => void;
}

const TAG_WIDTH = 60;

export function UngroupedSidebar({
  ungroupedRepos,
  onViewDetails,
  isOpen: controlledIsOpen,
  onOpenChange,
  draggingRepoId,
  onRepoDragStart,
  onRepoDragEnd,
}: UngroupedSidebarProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("stars");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const hasUngrouped = ungroupedRepos.length > 0;
  const sortedUngroupedRepos = useMemo(
    () => sortRepositories(ungroupedRepos, sortBy, sortOrder),
    [ungroupedRepos, sortBy, sortOrder]
  );

  const setOpen = (open: boolean) => {
    if (onOpenChange) {
      onOpenChange(open);
      return;
    }

    setInternalIsOpen(open);
  };

  useEffect(() => {
    const savedSortBy = localStorage.getItem("ungrouped-sidebar-sort-by") as SortBy | null;
    const savedSortOrder = localStorage.getItem("ungrouped-sidebar-sort-order") as SortOrder | null;

    if (savedSortBy) {
      setSortBy(savedSortBy);
    }

    if (savedSortOrder) {
      setSortOrder(savedSortOrder);
    }
  }, []);

  const handleSortChange = (nextSortBy: SortBy) => {
    setSortBy(nextSortBy);
    localStorage.setItem("ungrouped-sidebar-sort-by", nextSortBy);
  };

  const handleOrderToggle = () => {
    const nextOrder: SortOrder = sortOrder === "asc" ? "desc" : "asc";
    setSortOrder(nextOrder);
    localStorage.setItem("ungrouped-sidebar-sort-order", nextOrder);
  };

  return (
    <div
      className="pointer-events-none fixed right-0 top-16 z-40 h-[calc(100dvh-4rem)] w-screen max-w-[380px]"
    >
      <div
        className="pointer-events-auto absolute inset-y-0 right-0 flex w-full transition-transform duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
        style={{ transform: isOpen ? "translateX(0)" : `translateX(calc(100% - ${TAG_WIDTH}px))` }}
      >
        <button
          type="button"
          aria-label={isOpen ? "收起未分组仓库" : "展开未分组仓库"}
          aria-controls="ungrouped-repository-panel"
          aria-expanded={isOpen}
          onClick={() => setOpen(!isOpen)}
          className="
            relative my-auto w-[60px] shrink-0 cursor-pointer overflow-hidden
            rounded-l-2xl border-b border-l border-t border-amber-400
            bg-amber-600 py-4 shadow-lg focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-ring focus-visible:ring-offset-2
          "
        >
          <div className="flex flex-col items-center justify-center gap-3">
            <FolderOpen className="h-6 w-6 shrink-0 text-white" />

            <span
              className="text-sm font-medium text-white"
              style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
            >
              未分组
            </span>

            <Badge
              className={`text-xs font-bold text-white ${
                hasUngrouped ? "bg-white/30" : "bg-white/20"
              }`}
            >
              {ungroupedRepos.length}
            </Badge>

            {!isOpen && hasUngrouped && (
              <span>
                <ChevronRight className="h-4 w-4 rotate-180 text-white/80" />
              </span>
            )}
          </div>
        </button>

        <div
          id="ungrouped-repository-panel"
          aria-hidden={!isOpen}
          inert={!isOpen}
          className="h-full min-w-0 flex-1 overflow-hidden border-l border-amber-300 bg-background shadow-2xl"
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="sticky top-0 z-10 border-b border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5 text-amber-600" />
                  <div>
                    <h3 className="text-sm font-semibold text-amber-900">未分组仓库</h3>
                    <p className="text-xs text-amber-700">共 {ungroupedRepos.length} 个</p>
                  </div>
                </div>

                <Badge className="bg-amber-500 text-xs text-white hover:bg-amber-600">
                  {ungroupedRepos.length}
                </Badge>
              </div>

              <div className="mt-3 flex justify-end">
                <SortControl
                  value={sortBy}
                  order={sortOrder}
                  onSortChange={handleSortChange}
                  onOrderToggle={handleOrderToggle}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pb-6 pr-2 scrollbar-thin">
              {sortedUngroupedRepos.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-amber-600/60">
                  <FolderOpen className="mb-2 h-10 w-10" />
                  <p className="text-sm">暂无未分组仓库</p>
                </div>
              ) : (
                sortedUngroupedRepos.map((repo) => (
                  <div
                    key={repo.id}
                    className="group"
                  >
                    <Card
                      className="
                        cursor-pointer border border-gray-200 bg-white p-3 shadow-sm transition-all
                        hover:border-amber-300 hover:bg-amber-50 hover:shadow
                      "
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(repo.id));
                        onRepoDragStart?.(repo);
                        setOpen(true);
                      }}
                      onDragEnd={() => {
                        onRepoDragEnd?.();
                      }}
                      style={{
                        cursor: draggingRepoId === repo.id ? "grabbing" : "grab",
                        opacity: draggingRepoId === repo.id ? 0.45 : 1,
                      }}
                      onClick={() => onViewDetails(repo.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p
                            className="
                              truncate text-sm font-medium text-gray-900 transition-colors
                              group-hover:text-amber-700
                            "
                          >
                            {repo.owner}/{repo.name}
                          </p>

                          <div className="mt-1.5 flex items-center gap-2">
                            {repo.language && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                                {repo.language}
                              </span>
                            )}

                            <span className="flex items-center gap-0.5 text-xs text-gray-500">
                              <span>★</span>
                              <span>{repo.stars.toLocaleString()}</span>
                            </span>
                          </div>
                        </div>

                        <ChevronRight
                          className="
                            mt-1 h-4 w-4 shrink-0 text-gray-400 transition-colors
                            group-hover:text-amber-600
                          "
                        />
                      </div>
                    </Card>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
