/**
 * @package @devscope/web
 * @description 关注列表排序控制组件
 *
 * 提供关注列表的排序功能。
 */

"use client";

import { useState, useEffect } from "react";
import { Button } from "./ui/button";

export type FollowingSortBy = "followedAt" | "name" | "stars";
export type SortOrder = "asc" | "desc";

interface FollowingSortOption {
  value: FollowingSortBy;
  label: string;
  icon: string;
}

const sortOptions: FollowingSortOption[] = [
  { value: "followedAt", label: "按关注时间", icon: "🕐" },
  { value: "name", label: "按名称", icon: "🔤" },
  { value: "stars", label: "按星级", icon: "⭐" },
];

interface FollowingSortControlProps {
  sortBy: FollowingSortBy;
  sortOrder: SortOrder;
  onSortChange: (sortBy: FollowingSortBy, sortOrder: SortOrder) => void;
}

export function FollowingSortControl({
  sortBy,
  sortOrder,
  onSortChange,
}: FollowingSortControlProps) {
  const [isOpen, setIsOpen] = useState(false);

  // 从 localStorage 读取偏好
  useEffect(() => {
    const savedSortBy = localStorage.getItem("followingSortBy") as FollowingSortBy | null;
    const savedSortOrder = localStorage.getItem("followingSortOrder") as SortOrder | null;
    if (savedSortBy && savedSortOrder) {
      onSortChange(savedSortBy, savedSortOrder);
    }
  }, [onSortChange]);

  // 保存到 localStorage
  const handleSortChange = (newSortBy: FollowingSortBy, newSortOrder: SortOrder) => {
    localStorage.setItem("followingSortBy", newSortBy);
    localStorage.setItem("followingSortOrder", newSortOrder);
    onSortChange(newSortBy, newSortOrder);
    setIsOpen(false);
  };

  const toggleSortOrder = () => {
    const newOrder = sortOrder === "asc" ? "desc" : "asc";
    handleSortChange(sortBy, newOrder);
  };

  const currentOption = sortOptions.find((opt) => opt.value === sortBy);

  return (
    <div className="flex items-center gap-2">
      {/* 排序方式下拉 */}
      <div className="relative">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsOpen(!isOpen)}
          className="min-w-[140px] justify-start"
        >
          <span className="mr-2">{currentOption?.icon}</span>
          <span className="flex-1 text-left">{currentOption?.label}</span>
          <span className="ml-2 text-xs text-muted-foreground">▼</span>
        </Button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[140px]">
            {sortOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => handleSortChange(option.value, sortOrder)}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-slate-100 transition-colors flex items-center gap-2 ${
                  sortBy === option.value ? "bg-blue-50 text-blue-700" : ""
                }`}
              >
                <span>{option.icon}</span>
                <span>{option.label}</span>
                {sortBy === option.value && <span className="ml-auto">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 正序/倒序切换 */}
      <Button
        size="sm"
        variant="outline"
        onClick={toggleSortOrder}
        className="min-w-[100px]"
        title={sortOrder === "asc" ? "切换到倒序" : "切换到正序"}
      >
        {sortOrder === "asc" ? (
          <>
            <span className="mr-1">↑</span>正序
          </>
        ) : (
          <>
            <span className="mr-1">↓</span>倒序
          </>
        )}
      </Button>
    </div>
  );
}
