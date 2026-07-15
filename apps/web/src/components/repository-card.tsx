/**
 * @package @devscope/web
 * @description 仓库摘要组件，支持卡片和列表两种密度。
 */

'use client';

import { useState } from 'react';
import type { Repository, RepositoryGroup } from '@devscope/shared';
import { Check, ChevronRight, CircleDot, GitFork, Pencil, Scale, Star, X } from 'lucide-react';
import type { ViewMode } from './view-toggle';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';
import { getGroupColor } from '@/lib/group-config';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

interface RepositoryCardProps {
  repository: Repository;
  onViewDetails: (id: number) => void;
  viewMode?: ViewMode;
  groups?: RepositoryGroup[];
}

export function RepositoryCard({
  repository,
  onViewDetails,
  viewMode = 'card',
  groups = [],
}: RepositoryCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [savedNote, setSavedNote] = useState(repository.note ?? '');
  const updateNoteMutation = trpc.updateRepoNote.useMutation({
    onSuccess: (_, variables) => {
      setSavedNote(variables.note);
      setIsEditing(false);
    },
  });

  const displayDescription = savedNote || repository.description;

  const handleSaveNote = () => {
    updateNoteMutation.mutate({
      repoId: repository.id,
      note: editValue.trim(),
    });
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const handleStartEdit = () => {
    setEditValue(savedNote);
    setIsEditing(true);
  };

  return (
    <Card className="group h-full shadow-none transition-colors hover:border-slate-300">
      <CardContent className="p-4">
        <div
          className={cn(
            'flex min-w-0 gap-4',
            viewMode === 'card' ? 'h-full flex-col' : 'flex-col sm:flex-row sm:items-start'
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <a
                href={repository.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate font-semibold text-primary underline-offset-4 hover:underline"
              >
                {repository.owner}/{repository.name}
              </a>
              {repository.language && (
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {repository.language}
                </span>
              )}
              {groups.map((group) => {
                const color = getGroupColor(group.color);
                return (
                  <span
                    key={group.id}
                    className={cn(
                      'rounded-md border px-2 py-0.5 text-xs font-medium',
                      color.bg,
                      color.text,
                      color.border
                    )}
                  >
                    {group.name}
                  </span>
                );
              })}
            </div>

            {isEditing ? (
              <div className="mt-3 flex items-center gap-2">
                <Input
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleSaveNote();
                    if (event.key === 'Escape') handleCancelEdit();
                  }}
                  placeholder="添加仓库备注"
                  aria-label="仓库备注"
                  className="h-9"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={handleSaveNote}
                  disabled={updateNoteMutation.isPending}
                  aria-label="保存备注"
                >
                  <Check />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={handleCancelEdit}
                  aria-label="取消编辑"
                >
                  <X />
                </Button>
              </div>
            ) : (
              <div className="mt-2 flex min-w-0 items-start gap-2">
                <p
                  className={cn(
                    'min-w-0 flex-1 text-sm',
                    displayDescription
                      ? savedNote
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  {displayDescription || '暂无简介或备注'}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  onClick={handleStartEdit}
                  aria-label={savedNote ? '编辑备注' : '添加备注'}
                >
                  <Pencil />
                </Button>
              </div>
            )}

            {updateNoteMutation.error && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                备注保存失败：{updateNoteMutation.error.message}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              <Metric icon={Star} label="Star" value={repository.stars} />
              <Metric icon={GitFork} label="Fork" value={repository.forks} />
              <Metric icon={CircleDot} label="Issue" value={repository.openIssues} />
              {repository.license && (
                <span className="inline-flex items-center gap-1.5">
                  <Scale className="h-3.5 w-3.5" />
                  {repository.license}
                </span>
              )}
              {repository.lastFetchedAt && (
                <span>采集于 {new Date(repository.lastFetchedAt).toLocaleDateString('zh-CN')}</span>
              )}
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn('shrink-0', viewMode === 'card' && 'mt-auto self-start')}
            onClick={() => onViewDetails(repository.id)}
          >
            查看详情
            <ChevronRight />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Star; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`${label} ${value}`}>
      <Icon className="h-3.5 w-3.5" />
      <span className="tabular-nums">{value.toLocaleString()}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
