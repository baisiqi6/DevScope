/**
 * @package @devscope/web/lib
 * @description 仓库分组配置
 *
 * 定义分组的颜色和图标选项。
 *
 * @module group-config
 */

import {
  Folder,
  Code,
  Database,
  Globe,
  Rocket,
  Zap,
  Star,
  Heart,
  Wrench,
  BookOpen,
  Cpu,
  Layers,
  Tag,
  Archive,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ============================================================================
// 类型定义
// ============================================================================

export interface GroupColorOption {
  readonly value: string;
  readonly label: string;
  readonly bg: string;
  readonly text: string;
  readonly border: string;
  readonly hoverBg: string;
  readonly solidBg: string;
  readonly solidText: string;
}

export interface GroupIconOption {
  readonly value: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

// ============================================================================
// 颜色配置
// ============================================================================

/**
 * 分组颜色选项
 */
export const GROUP_COLORS: readonly GroupColorOption[] = [
  {
    value: "blue",
    label: "蓝色",
    bg: "bg-blue-100",
    text: "text-blue-700",
    border: "border-blue-200",
    hoverBg: "hover:bg-blue-50",
    solidBg: "bg-blue-600",
    solidText: "text-white",
  },
  {
    value: "green",
    label: "绿色",
    bg: "bg-green-100",
    text: "text-green-700",
    border: "border-green-200",
    hoverBg: "hover:bg-green-50",
    solidBg: "bg-green-600",
    solidText: "text-white",
  },
  {
    value: "purple",
    label: "紫色",
    bg: "bg-purple-100",
    text: "text-purple-700",
    border: "border-purple-200",
    hoverBg: "hover:bg-purple-50",
    solidBg: "bg-purple-600",
    solidText: "text-white",
  },
  {
    value: "orange",
    label: "橙色",
    bg: "bg-orange-100",
    text: "text-orange-700",
    border: "border-orange-200",
    hoverBg: "hover:bg-orange-50",
    solidBg: "bg-orange-600",
    solidText: "text-white",
  },
  {
    value: "red",
    label: "红色",
    bg: "bg-red-100",
    text: "text-red-700",
    border: "border-red-200",
    hoverBg: "hover:bg-red-50",
    solidBg: "bg-red-600",
    solidText: "text-white",
  },
  {
    value: "pink",
    label: "粉色",
    bg: "bg-pink-100",
    text: "text-pink-700",
    border: "border-pink-200",
    hoverBg: "hover:bg-pink-50",
    solidBg: "bg-pink-600",
    solidText: "text-white",
  },
] as const;

/**
 * 根据颜色值获取颜色配置
 */
export function getGroupColor(colorValue: string): GroupColorOption {
  return (
    GROUP_COLORS.find((c) => c.value === colorValue) || GROUP_COLORS[0]
  );
}

// ============================================================================
// 图标配置
// ============================================================================

/**
 * 分组图标选项
 */
export const GROUP_ICONS: readonly GroupIconOption[] = [
  { value: "folder", label: "文件夹", icon: Folder },
  { value: "code", label: "代码", icon: Code },
  { value: "database", label: "数据库", icon: Database },
  { value: "globe", label: "网络", icon: Globe },
  { value: "rocket", label: "启动", icon: Rocket },
  { value: "zap", label: "闪电", icon: Zap },
  { value: "star", label: "星标", icon: Star },
  { value: "heart", label: "收藏", icon: Heart },
  { value: "wrench", label: "工具", icon: Wrench },
  { value: "book", label: "文档", icon: BookOpen },
  { value: "cpu", label: "硬件", icon: Cpu },
  { value: "layers", label: "层级", icon: Layers },
  { value: "tag", label: "标签", icon: Tag },
  { value: "archive", label: "归档", icon: Archive },
] as const;

/**
 * 根据图标值获取图标配置
 */
export function getGroupIcon(iconValue: string): GroupIconOption {
  return (
    GROUP_ICONS.find((i) => i.value === iconValue) || GROUP_ICONS[0]
  );
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 获取分组显示样式类名
 */
export function getGroupColorClasses(color: string, type: "bg" | "text" | "border" | "solid"): string {
  const colorConfig = getGroupColor(color);

  switch (type) {
    case "bg":
      return colorConfig.bg;
    case "text":
      return colorConfig.text;
    case "border":
      return colorConfig.border;
    case "solid":
      return `${colorConfig.solidBg} ${colorConfig.solidText}`;
    default:
      return "";
  }
}
