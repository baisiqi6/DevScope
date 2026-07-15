/**
 * @package @devscope/web
 * @description ViewModeToggle 组件
 *
 * 提供卡片/列表视图模式切换功能。
 */

'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { LayoutGrid, List } from 'lucide-react';

export type ViewMode = 'card' | 'list';

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div
      className="flex items-center rounded-md border bg-background p-0.5"
      role="group"
      aria-label="仓库视图"
    >
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onChange('card')}
        aria-pressed={value === 'card'}
        aria-label="卡片视图"
        className={`h-8 px-2.5 ${
          value === 'card' ? 'bg-muted text-foreground' : 'text-muted-foreground'
        }`}
      >
        <LayoutGrid className="h-4 w-4" />
        <span className="hidden text-sm sm:inline">卡片</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onChange('list')}
        aria-pressed={value === 'list'}
        aria-label="列表视图"
        className={`h-8 px-2.5 ${
          value === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground'
        }`}
      >
        <List className="h-4 w-4" />
        <span className="hidden text-sm sm:inline">列表</span>
      </Button>
    </div>
  );
}

/**
 * Hook for persisting view mode in localStorage
 */
export function useViewMode(initialMode: ViewMode = 'list') {
  const [viewMode, setViewMode] = useState<ViewMode>(initialMode);

  useEffect(() => {
    const saved = localStorage.getItem('repository-view-mode') as ViewMode | null;
    if (saved === 'card' || saved === 'list') {
      setViewMode(saved);
    }
  }, []);

  const handleSetViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('repository-view-mode', mode);
  };

  return [viewMode, handleSetViewMode] as const;
}
