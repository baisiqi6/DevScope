/**
 * @package @devscope/web
 * @description SortControl 组件
 *
 * 提供仓库排序功能，支持多种排序方式和正序/倒序切换。
 */

'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { ArrowUp, ArrowDown } from 'lucide-react';

export type SortBy = 'name' | 'stars' | 'forks' | 'updatedAt' | 'followedAt';
export type SortOrder = 'asc' | 'desc';

interface SortOption {
  value: SortBy;
  label: string;
}

const sortOptions: SortOption[] = [
  { value: 'name', label: '名称' },
  { value: 'stars', label: 'Star' },
  { value: 'forks', label: 'Fork' },
  { value: 'updatedAt', label: '最近采集' },
  { value: 'followedAt', label: '最近关注' },
];

interface SortControlProps {
  value: SortBy;
  order: SortOrder;
  onSortChange: (sortBy: SortBy) => void;
  onOrderToggle: () => void;
}

export function SortControl({ value, order, onSortChange, onOrderToggle }: SortControlProps) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="仓库排序">
      <div>
        <label htmlFor="repository-sort" className="sr-only">
          排序方式
        </label>
        <select
          id="repository-sort"
          value={value}
          onChange={(e) => onSortChange(e.target.value as SortBy)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onOrderToggle}
        className="h-9 px-2.5"
        aria-label={order === 'asc' ? '当前正序，切换为倒序' : '当前倒序，切换为正序'}
      >
        {order === 'asc' ? <ArrowUp /> : <ArrowDown />}
        <span className="hidden sm:inline">{order === 'asc' ? '正序' : '倒序'}</span>
      </Button>
    </div>
  );
}

/**
 * Hook for persisting sort preferences in localStorage
 */
export function useSortPreferences(
  initialSortBy: SortBy = 'stars',
  initialOrder: SortOrder = 'desc'
) {
  const [sortBy, setSortBy] = useState<SortBy>(initialSortBy);
  const [order, setOrder] = useState<SortOrder>(initialOrder);

  useEffect(() => {
    const savedSortBy = localStorage.getItem('repository-sort-by') as SortBy | null;
    const savedOrder = localStorage.getItem('repository-sort-order') as SortOrder | null;
    if (savedSortBy) setSortBy(savedSortBy);
    if (savedOrder) setOrder(savedOrder);
  }, []);

  const handleSetSortBy = (value: SortBy) => {
    setSortBy(value);
    localStorage.setItem('repository-sort-by', value);
  };

  const handleToggleOrder = () => {
    const newOrder = order === 'asc' ? 'desc' : 'asc';
    setOrder(newOrder);
    localStorage.setItem('repository-sort-order', newOrder);
  };

  return { sortBy, order, setSortBy: handleSetSortBy, toggleOrder: handleToggleOrder };
}

/**
 * Sort repositories based on the given criteria
 */
export function sortRepositories<
  T extends {
    id?: number;
    name?: string;
    owner?: string;
    stars?: number;
    forks?: number;
    lastFetchedAt?: string | null;
    starredAt?: string | null;
  },
>(repositories: T[], sortBy: SortBy, order: SortOrder): T[] {
  const sorted = [...repositories].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'name':
        const aName = `${a.owner}/${a.name}`.toLowerCase();
        const bName = `${b.owner}/${b.name}`.toLowerCase();
        comparison = aName.localeCompare(bName);
        break;
      case 'stars':
        comparison = (a.stars || 0) - (b.stars || 0);
        break;
      case 'forks':
        comparison = (a.forks || 0) - (b.forks || 0);
        break;
      case 'updatedAt':
        const aTime = a.lastFetchedAt ? new Date(a.lastFetchedAt).getTime() : 0;
        const bTime = b.lastFetchedAt ? new Date(b.lastFetchedAt).getTime() : 0;
        comparison = aTime - bTime;
        break;
      case 'followedAt':
        const aFollowed = a.starredAt ? new Date(a.starredAt).getTime() : 0;
        const bFollowed = b.starredAt ? new Date(b.starredAt).getTime() : 0;
        comparison = aFollowed - bFollowed;
        break;
    }

    return order === 'asc' ? comparison : -comparison;
  });

  return sorted;
}
