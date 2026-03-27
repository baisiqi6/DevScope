"use client";

import { motion } from "framer-motion";
import type { RepositoryGroup } from "@devscope/shared";
import { Badge } from "@/components/ui/badge";
import { getGroupColor, getGroupIcon } from "@/lib/group-config";

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
  void onCreateGroup;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <GroupTab
          name="鍏ㄩ儴浠撳簱"
          count={totalRepoCount}
          isSelected={selectedGroupId === null && !isUngroupedSelected}
          color="gray"
          icon={null}
          onClick={onSelectAll}
        />

        {onSelectUngrouped && (
          <GroupTab
            name="\u672a\u5206\u7ec4"
            count={ungroupedRepoCount}
            isSelected={isUngroupedSelected}
            color="amber"
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
            color={group.color}
            icon={group.icon}
            onClick={() => onSelectGroup(group)}
          />
        ))}
      </div>
    </div>
  );
}

interface GroupTabProps {
  name: string;
  count: number;
  isSelected: boolean;
  color: string;
  icon: string | null;
  onClick: () => void;
  showDot?: boolean;
}

function GroupTab({
  name,
  count,
  isSelected,
  color,
  icon,
  onClick,
  showDot = false,
}: GroupTabProps) {
  const colorConfig = getGroupColor(color);
  const iconConfig = icon ? getGroupIcon(icon) : null;
  const IconComponent = iconConfig?.icon;

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`
        inline-flex max-w-full items-center gap-2 rounded-lg border-2 px-3 py-1.5 transition-all
        ${
          isSelected
            ? `${colorConfig.solidBg} ${colorConfig.solidText} border-transparent`
            : `${colorConfig.bg} ${colorConfig.text} ${colorConfig.border} hover:${colorConfig.hoverBg}`
        }
      `}
    >
      {IconComponent && <IconComponent className="h-4 w-4" />}

      <span className="max-w-[180px] truncate text-sm font-medium">{name}</span>

      <Badge
        variant="secondary"
        className={`
          ${
            isSelected
              ? "bg-white/20 text-white hover:bg-white/30"
              : "bg-gray-200 text-gray-600"
          }
        `}
      >
        {count}
      </Badge>

      {showDot && <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />}
    </motion.button>
  );
}


