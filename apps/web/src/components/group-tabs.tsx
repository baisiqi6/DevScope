/**
 * @package @devscope/web/components
 * @description 分组标签栏组件
 *
 * 显示所有分组标签，支持切换、创建和搜索。
 *
 * @module group-tabs
 */

"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { getGroupIcon, getGroupColor } from "@/lib/group-config";
import type { RepositoryGroup } from "@devscope/shared";
import { motion } from "framer-motion";

// ============================================================================
// 类型定义
// ============================================================================

interface GroupTabsProps {
  /** 所有分组列表 */
  groups: RepositoryGroup[];
  /** 当前选中的分组 ID（null 表示全部仓库） */
  selectedGroupId: number | null;
  /** 仓库总数 */
  totalRepoCount: number;
  /** 切换到「全部仓库」 */
  onSelectAll: () => void;
  /** 选中分组 */
  onSelectGroup: (group: RepositoryGroup) => void;
  /** 创建新分组 */
  onCreateGroup: () => void;
}

// ============================================================================
// 组件
// ============================================================================

/**
 * 分组标签栏组件
 */
export function GroupTabs({
  groups,
  selectedGroupId,
  totalRepoCount,
  onSelectAll,
  onSelectGroup,
  onCreateGroup,
}: GroupTabsProps) {
  return (
    <div className="space-y-3">
      {/* 分组标签列表 */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
        {/* 全部仓库标签 */}
        <GroupTab
          name="全部仓库"
          count={totalRepoCount}
          isSelected={selectedGroupId === null}
          color="gray"
          icon={null}
          onClick={onSelectAll}
        />

        {/* 分隔线 */}
        <div className="w-px h-6 bg-gray-300 dark:bg-gray-700" />

        {/* 分组标签 */}
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

// ============================================================================
// 子组件
// ============================================================================

interface GroupTabProps {
  name: string;
  count: number;
  isSelected: boolean;
  color: string;
  icon: string | null;
  onClick: () => void;
  showDot?: boolean;
}

/**
 * 单个分组标签组件
 */
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
        flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 transition-all
        ${isSelected
          ? `${colorConfig.solidBg} ${colorConfig.solidText} border-transparent`
          : `${colorConfig.bg} ${colorConfig.text} ${colorConfig.border} hover:${colorConfig.hoverBg}`
        }
      `}
    >
      {/* 图标 */}
      {IconComponent && (
        <IconComponent className="h-4 w-4" />
      )}

      {/* 名称 */}
      <span className="text-sm font-medium">{name}</span>

      {/* 数量 */}
      <Badge
        variant="secondary"
        className={`
          ${isSelected
            ? "bg-white/20 text-white hover:bg-white/30"
            : "bg-gray-200 text-gray-600"
          }
        `}
      >
        {count}
      </Badge>

      {/* 提示点 */}
      {showDot && (
        <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
      )}
    </motion.button>
  );
}
