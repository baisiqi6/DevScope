'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, FolderOpen, GripVertical, Star } from 'lucide-react';
import type { Repository } from '@devscope/shared';
import { Button } from './ui/button';
import { SortControl, type SortBy, type SortOrder, sortRepositories } from './sort-control';

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
  const [sortBy, setSortBy] = useState<SortBy>('stars');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
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
    const savedSortBy = localStorage.getItem('ungrouped-sidebar-sort-by') as SortBy | null;
    const savedSortOrder = localStorage.getItem('ungrouped-sidebar-sort-order') as SortOrder | null;

    if (savedSortBy) {
      setSortBy(savedSortBy);
    }

    if (savedSortOrder) {
      setSortOrder(savedSortOrder);
    }
  }, []);

  const handleSortChange = (nextSortBy: SortBy) => {
    setSortBy(nextSortBy);
    localStorage.setItem('ungrouped-sidebar-sort-by', nextSortBy);
  };

  const handleOrderToggle = () => {
    const nextOrder: SortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    setSortOrder(nextOrder);
    localStorage.setItem('ungrouped-sidebar-sort-order', nextOrder);
  };

  return (
    <div className="pointer-events-none fixed right-0 top-16 z-40 h-[calc(100dvh-4rem)] w-screen max-w-[380px]">
      <div
        className="pointer-events-auto absolute inset-y-0 right-0 flex w-full transition-transform duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
        style={{ transform: isOpen ? 'translateX(0)' : `translateX(calc(100% - ${TAG_WIDTH}px))` }}
      >
        <button
          type="button"
          aria-label={isOpen ? '收起未分组仓库' : '展开未分组仓库'}
          aria-controls="ungrouped-repository-panel"
          aria-expanded={isOpen}
          onClick={() => setOpen(!isOpen)}
          className="
            relative my-auto w-[60px] shrink-0 cursor-pointer overflow-hidden
            rounded-l-lg border-b border-l border-t border-primary/45
            bg-card py-4 text-primary shadow-sm focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-ring focus-visible:ring-offset-2
          "
        >
          <div className="flex flex-col items-center justify-center gap-3">
            <FolderOpen className="h-6 w-6 shrink-0 text-primary" />

            <span
              className="text-sm font-medium text-foreground"
              style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
            >
              未分组
            </span>

            <span
              className={`rounded px-1.5 py-0.5 text-xs font-semibold text-primary ${hasUngrouped ? 'bg-primary/15' : 'bg-muted'}`}
            >
              {ungroupedRepos.length}
            </span>

            {!isOpen && hasUngrouped && (
              <span>
                <ChevronRight className="h-4 w-4 rotate-180 text-muted-foreground" />
              </span>
            )}
          </div>
        </button>

        <div
          id="ungrouped-repository-panel"
          aria-hidden={!isOpen}
          inert={!isOpen}
          className="h-full min-w-0 flex-1 overflow-hidden border-l bg-background shadow-lg"
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="sticky top-0 z-10 border-b bg-background px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5 text-primary" />
                  <div>
                    <h3 className="text-sm font-semibold">未分组仓库</h3>
                    <p className="text-xs text-muted-foreground">共 {ungroupedRepos.length} 个</p>
                  </div>
                </div>
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
                <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                  <FolderOpen className="mb-2 h-10 w-10" />
                  <p className="text-sm">暂无未分组仓库</p>
                </div>
              ) : (
                sortedUngroupedRepos.map((repo) => (
                  <div
                    key={repo.id}
                    className="flex items-start gap-2 rounded-lg border bg-card p-3 transition-colors hover:border-primary/30 hover:bg-muted/40"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', String(repo.id));
                      onRepoDragStart?.(repo);
                      setOpen(true);
                    }}
                    onDragEnd={() => {
                      onRepoDragEnd?.();
                    }}
                    style={{
                      cursor: draggingRepoId === repo.id ? 'grabbing' : 'grab',
                      opacity: draggingRepoId === repo.id ? 0.45 : 1,
                    }}
                  >
                    <GripVertical
                      aria-hidden="true"
                      className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {repo.owner}/{repo.name}
                      </p>

                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {repo.language && (
                          <span className="rounded bg-muted px-2 py-0.5 font-medium">
                            {repo.language}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Star className="h-3.5 w-3.5" />
                          {repo.stars.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => onViewDetails(repo.id)}
                      aria-label={`查看 ${repo.owner}/${repo.name} 详情`}
                    >
                      <ChevronRight />
                    </Button>
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
