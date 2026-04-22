/**
 * @package @devscope/web
 * @description SortControl 组件
 *
 * 提供仓库排序功能，支持多种排序方式和正序/倒序切换。
 */

"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

export type SortBy = "name" | "stars" | "forks" | "updatedAt" | "followedAt";
export type SortOrder = "asc" | "desc";

interface SortOption {
  value: SortBy;
  label: string;
  icon: string;
}

const sortOptions: SortOption[] = [
  { value: "name", label: "按名称", icon: "🔤" },
  { value: "stars", label: "按星级", icon: "⭐" },
  { value: "forks", label: "按 Fork", icon: "🔱" },
  { value: "updatedAt", label: "按更新时间", icon: "🕐" },
  { value: "followedAt", label: "按关注时间", icon: "⭐" },
];

interface SortControlProps {
  value: SortBy;
  order: SortOrder;
  onSortChange: (sortBy: SortBy) => void;
  onOrderToggle: () => void;
}

export function SortControl({ value, order, onSortChange, onOrderToggle }: SortControlProps) {
  const currentOption = sortOptions.find((opt) => opt.value === value) || sortOptions[0];

  return (
    <div className="flex items-center gap-2">
      {/* 正序/倒序切换按钮 */}
      <Button
        size="sm"
        variant="outline"
        onClick={onOrderToggle}
        className="h-9 px-3 bg-white/80 backdrop-blur-sm border-slate-200/60 hover:bg-slate-50 hover:border-slate-300 transition-all"
        title={order === "asc" ? "当前：正序，点击切换为倒序" : "当前：倒序，点击切换为正序"}
      >
        {order === "asc" ? (
          <ArrowUp className="h-4 w-4 text-blue-600" />
        ) : (
          <ArrowDown className="h-4 w-4 text-blue-600" />
        )}
        <span className="ml-1.5 text-sm font-medium">
          {order === "asc" ? "正序" : "倒序"}
        </span>
      </Button>

      {/* 排序方式下拉选择 */}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onSortChange(e.target.value as SortBy)}
          className="h-9 pl-9 pr-10 bg-white/80 backdrop-blur-sm border border-slate-200/60 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer appearance-none pr-10"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.icon} {option.label}
            </option>
          ))}
        </select>

        {/* 左侧图标 */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <span className="text-sm">{currentOption.icon}</span>
        </div>

        {/* 右侧下拉箭头 */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <ArrowUpDown className="h-4 w-4 text-slate-400" />
        </div>
      </div>
    </div>
  );
}

/**
 * Hook for persisting sort preferences in localStorage
 */
export function useSortPreferences(
  initialSortBy: SortBy = "stars",
  initialOrder: SortOrder = "desc"
) {
  const [sortBy, setSortBy] = useState<SortBy>(initialSortBy);
  const [order, setOrder] = useState<SortOrder>(initialOrder);

  useEffect(() => {
    const savedSortBy = localStorage.getItem("repository-sort-by") as SortBy | null;
    const savedOrder = localStorage.getItem("repository-sort-order") as SortOrder | null;
    if (savedSortBy) setSortBy(savedSortBy);
    if (savedOrder) setOrder(savedOrder);
  }, []);

  const handleSetSortBy = (value: SortBy) => {
    setSortBy(value);
    localStorage.setItem("repository-sort-by", value);
  };

  const handleToggleOrder = () => {
    const newOrder = order === "asc" ? "desc" : "asc";
    setOrder(newOrder);
    localStorage.setItem("repository-sort-order", newOrder);
  };

  return { sortBy, order, setSortBy: handleSetSortBy, toggleOrder: handleToggleOrder };
}

/**
 * Sort repositories based on the given criteria
 */
export function sortRepositories<T extends {
  id?: number;
  name?: string;
  owner?: string;
  stars?: number;
  forks?: number;
  lastFetchedAt?: string | null;
  starredAt?: string | null;
}>(
  repositories: T[],
  sortBy: SortBy,
  order: SortOrder
): T[] {
  const sorted = [...repositories].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "name":
        const aName = `${a.owner}/${a.name}`.toLowerCase();
        const bName = `${b.owner}/${b.name}`.toLowerCase();
        comparison = aName.localeCompare(bName);
        break;
      case "stars":
        comparison = (a.stars || 0) - (b.stars || 0);
        break;
      case "forks":
        comparison = (a.forks || 0) - (b.forks || 0);
        break;
      case "updatedAt":
        const aTime = a.lastFetchedAt ? new Date(a.lastFetchedAt).getTime() : 0;
        const bTime = b.lastFetchedAt ? new Date(b.lastFetchedAt).getTime() : 0;
        comparison = aTime - bTime;
        break;
      case "followedAt":
        const aFollowed = a.starredAt ? new Date(a.starredAt).getTime() : 0;
        const bFollowed = b.starredAt ? new Date(b.starredAt).getTime() : 0;
        comparison = aFollowed - bFollowed;
        break;
    }

    return order === "asc" ? comparison : -comparison;
  });

  return sorted;
}
