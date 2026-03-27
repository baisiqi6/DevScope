"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
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
const PANEL_WIDTH = 320;
const SIDEBAR_WIDTH = TAG_WIDTH + PANEL_WIDTH;

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
      className="pointer-events-none fixed right-0 top-0 z-40 h-screen"
      style={{ width: SIDEBAR_WIDTH }}
    >
      <motion.div
        className="absolute inset-y-0 right-0 flex pointer-events-auto"
        initial={false}
        animate={{ x: isOpen ? 0 : PANEL_WIDTH }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          if (draggingRepoId !== null && draggingRepoId !== undefined) {
            return;
          }
          setOpen(false);
        }}
      >
        <div
          className="
            relative my-auto w-[60px] shrink-0 cursor-pointer overflow-hidden
            rounded-l-2xl border-b border-l border-t border-amber-400
            bg-gradient-to-b from-amber-500 to-orange-500 py-4 shadow-lg
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
              <motion.div
                animate={{ x: [0, -5, 0], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
              >
                <ChevronRight className="h-4 w-4 rotate-180 text-white/80" />
              </motion.div>
            )}
          </div>

          {!isOpen && hasUngrouped && (
            <>
              <motion.div
                className="absolute inset-0 bg-white/20"
                animate={{ scale: [1, 1.02, 1], opacity: [0, 0.3, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <div className="absolute right-4 top-4">
                <motion.div
                  className="h-2 w-2 rounded-full bg-white"
                  animate={{ scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              </div>
            </>
          )}
        </div>

        <motion.div
          className="h-full w-[320px] overflow-hidden border-l-2 border-amber-300 bg-white shadow-2xl"
          initial={false}
          animate={{ opacity: isOpen ? 1 : 0.98 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
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
                  <motion.div
                    key={repo.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
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
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
