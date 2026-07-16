'use client';

import type { RepositoryGroup } from '@devscope/shared';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getGroupIcon } from '@/lib/group-config';
import { cn } from '@/lib/utils';

interface GroupTabsProps {
  groups: RepositoryGroup[];
  selectedGroupId: number | null;
  totalRepoCount: number;
  onSelectAll: () => void;
  onSelectGroup: (group: RepositoryGroup) => void;
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
  return (
    <nav aria-label="仓库分组" className="flex flex-wrap items-center gap-2">
      <GroupTab
        name="全部仓库"
        count={totalRepoCount}
        isSelected={selectedGroupId === null && !isUngroupedSelected}
        icon={null}
        onClick={onSelectAll}
      />

      {onSelectUngrouped && (
        <GroupTab
          name="未分组"
          count={ungroupedRepoCount}
          isSelected={isUngroupedSelected}
          icon={null}
          onClick={onSelectUngrouped}
        />
      )}

      {groups.map((group) => (
        <GroupTab
          key={group.id}
          name={group.name}
          count={group.repoCount ?? 0}
          isSelected={selectedGroupId === group.id}
          icon={group.icon}
          onClick={() => onSelectGroup(group)}
        />
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={onCreateGroup}>
        <Plus />
        新建分组
      </Button>
    </nav>
  );
}

interface GroupTabProps {
  name: string;
  count: number;
  isSelected: boolean;
  icon: string | null;
  onClick: () => void;
}

function GroupTab({ name, count, isSelected, icon, onClick }: GroupTabProps) {
  const iconConfig = icon ? getGroupIcon(icon) : null;
  const IconComponent = iconConfig?.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={cn(
        'inline-flex h-9 max-w-full items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isSelected
          ? 'border-primary/30 bg-primary/10 text-primary shadow-[inset_0_-1px_0_oklch(var(--primary)/0.35)]'
          : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {IconComponent && <IconComponent className="h-4 w-4" />}

      <span className="max-w-[180px] truncate text-sm font-medium">{name}</span>

      <span className="rounded bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
        {count}
      </span>
    </button>
  );
}
