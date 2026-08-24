'use client';

import { useMemo, useState } from 'react';
import type { RepositoryGroupTreeNode } from '@devscope/shared';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getGroupIcon } from '@/lib/group-config';
import { flattenGroupTree } from '@/lib/group-tree';
import { cn } from '@/lib/utils';

interface GroupTabsProps {
  groups: RepositoryGroupTreeNode[];
  selectedGroupId: number | null;
  totalRepoCount: number;
  onSelectAll: () => void;
  onSelectGroup: (group: RepositoryGroupTreeNode) => void;
  onCreateGroup: () => void;
  isUngroupedSelected?: boolean;
  ungroupedRepoCount?: number;
  onSelectUngrouped?: () => void;
}

export function GroupTabs({
  groups,
  selectedGroupId,
  totalRepoCount,
  onSelectAll,
  onSelectGroup,
  onCreateGroup,
  isUngroupedSelected = false,
  ungroupedRepoCount = 0,
  onSelectUngrouped,
}: GroupTabsProps) {
  const expandableIds = useMemo(
    () =>
      new Set(
        flattenGroupTree(groups)
          .filter(({ group }) => group.children.length > 0)
          .map(({ group }) => group.id)
      ),
    [groups]
  );
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpanded = (groupId: number) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <nav aria-label="仓库分组" className="command-surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 p-2">
        <ScopeButton
          name="全部仓库"
          count={totalRepoCount}
          isSelected={selectedGroupId === null && !isUngroupedSelected}
          onClick={onSelectAll}
        />
        {onSelectUngrouped && (
          <ScopeButton
            name="未分组"
            count={ungroupedRepoCount}
            isSelected={isUngroupedSelected}
            onClick={onSelectUngrouped}
          />
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onCreateGroup}>
          <Plus />
          新建分组
        </Button>
      </div>

      {groups.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">还没有仓库分组。</p>
      ) : (
        <ul role="tree" aria-label="分组层级" className="py-1">
          {groups.map((group) => (
            <GroupTreeItem
              key={group.id}
              group={group}
              depth={0}
              selectedGroupId={selectedGroupId}
              expandedIds={expandedIds}
              expandableIds={expandableIds}
              onToggle={toggleExpanded}
              onSelect={onSelectGroup}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}

interface GroupTreeItemProps {
  group: RepositoryGroupTreeNode;
  depth: number;
  selectedGroupId: number | null;
  expandedIds: Set<number>;
  expandableIds: Set<number>;
  onToggle: (groupId: number) => void;
  onSelect: (group: RepositoryGroupTreeNode) => void;
}

function GroupTreeItem({
  group,
  depth,
  selectedGroupId,
  expandedIds,
  expandableIds,
  onToggle,
  onSelect,
}: GroupTreeItemProps) {
  const hasChildren = expandableIds.has(group.id);
  const isExpanded = expandedIds.has(group.id);
  const isSelected = selectedGroupId === group.id;
  const IconComponent = getGroupIcon(group.icon).icon;

  return (
    <li
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? isExpanded : undefined}
    >
      <div
        className={cn(
          'flex min-w-0 items-center border-l-2 pr-2 transition-colors duration-150',
          isSelected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/60'
        )}
        style={{ paddingLeft: `${depth * 20 + 6}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onToggle(group.id)}
            aria-label={`${isExpanded ? '收起' : '展开'}分组 ${group.name}`}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="h-8 w-8 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={() => onSelect(group)}
          aria-current={isSelected ? 'page' : undefined}
          className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconComponent className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.name}</span>
          <span
            className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground"
            title={`直接 ${group.directRepoCount} 个；含后代 ${group.aggregateRepoCount} 个`}
          >
            {group.aggregateRepoCount}
          </span>
        </button>
      </div>
      {hasChildren && isExpanded && (
        <ul role="group">
          {group.children.map((child) => (
            <GroupTreeItem
              key={child.id}
              group={child}
              depth={depth + 1}
              selectedGroupId={selectedGroupId}
              expandedIds={expandedIds}
              expandableIds={expandableIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ScopeButton({
  name,
  count,
  isSelected,
  onClick,
}: {
  name: string;
  count: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isSelected
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-transparent text-muted-foreground hover:border-border-hover hover:bg-muted hover:text-foreground'
      )}
    >
      {name}
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
        {count}
      </span>
    </button>
  );
}
