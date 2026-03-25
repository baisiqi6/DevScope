/**
 * @package @devscope/web
 * @description ViewModeToggle 组件
 *
 * 提供卡片/列表视图模式切换功能。
 */

"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { LayoutGrid, List } from "lucide-react";

export type ViewMode = "card" | "list";

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div className="flex items-center gap-1 bg-slate-100/80 backdrop-blur-sm rounded-lg p-1 border border-slate-200/60">
      <Button
        size="sm"
        variant={value === "card" ? "default" : "ghost"}
        onClick={() => onChange("card")}
        className={`h-8 px-3 transition-all ${
          value === "card"
            ? "bg-white shadow-sm text-blue-600"
            : "text-slate-600 hover:text-slate-800 hover:bg-white/50"
        }`}
      >
        <LayoutGrid className="h-4 w-4" />
        <span className="ml-1.5 text-sm font-medium">卡片</span>
      </Button>
      <Button
        size="sm"
        variant={value === "list" ? "default" : "ghost"}
        onClick={() => onChange("list")}
        className={`h-8 px-3 transition-all ${
          value === "list"
            ? "bg-white shadow-sm text-blue-600"
            : "text-slate-600 hover:text-slate-800 hover:bg-white/50"
        }`}
      >
        <List className="h-4 w-4" />
        <span className="ml-1.5 text-sm font-medium">列表</span>
      </Button>
    </div>
  );
}

/**
 * Hook for persisting view mode in localStorage
 */
export function useViewMode(initialMode: ViewMode = "card") {
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);

  useEffect(() => {
    const saved = localStorage.getItem("repository-view-mode") as ViewMode | null;
    if (saved) {
      setViewMode(saved);
    }
  }, []);

  const handleSetViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem("repository-view-mode", mode);
  };

  return [viewMode, handleSetViewMode] as const;
}
