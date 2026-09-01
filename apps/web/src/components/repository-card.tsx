/**
 * @package @devscope/web
 * @description 仓库摘要组件，支持卡片和列表两种密度。
 */

'use client';

import { useState } from 'react';
import type { Repository, RepositoryGroup } from '@devscope/shared';
import { Archive, Check, ChevronRight, CircleDot, GitFork, Pencil, Scale, Star, Trash2, X } from 'lucide-react';
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
  const utils = trpc.useUtils();
  const updateNoteMutation = trpc.updateRepoNote.useMutation({
    onSuccess: (_, variables) => {
      setSavedNote(variables.note);
      setIsEditing(false);
    },
  });
  const archiveMutation = trpc.archiveRepository.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.getRepositories.invalidate(),
        utils.groupsQuery.getUngroupedRepos.invalidate(),
        utils.groups.getTree.invalidate(),
        utils.groups.getAggregateWithMembers.invalidate(),
      ]);
    },
  });
  const deleteMutation = trpc.deleteRepository.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.getRepositories.invalidate(),
        utils.groupsQuery.getUngroupedRepos.invalidate(),
        utils.groups.getTree.invalidate(),
        utils.groups.getAggregateWithMembers.invalidate(),
      ]);
    },
  });
  const deleteImpactQuery = trpc.getRepositoryDeleteImpact.useQuery(
    { repoId: repository.id },
    { enabled: false },
  );

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

  const handleArchive = () => {
    if (window.confirm(`归档 ${repository.owner}/${repository.name}？归档后可通过 API/MCP 恢复。`)) {
      archiveMutation.mutate({ repoId: repository.id });
    }
  };

  const handleDelete = async () => {
    if (deleteMutation.isPending || archiveMutation.isPending || deleteImpactQuery.isFetching) return;
    const impact = await deleteImpactQuery.refetch();
    if (impact.error || !impact.data) return;
    const confirmed = window.confirm(
      `永久删除 ${repository.owner}/${repository.name}？这将移除 ${impact.data.groupMemberships} 个分组成员、${impact.data.chunks} 个文本分块、${impact.data.releases} 个 Release、${impact.data.hackernewsItems} 条 HN 记录和 ${impact.data.technologyStacks} 条技术栈关系。此操作不可恢复。`,
    );
    if (confirmed) deleteMutation.mutate({ repoId: repository.id, confirm: true });
  };

  return (
    <Card className="command-surface group h-full transition-[transform,border-color,background-color] duration-150 hover:-translate-y-0.5 hover:border-border-hover hover:bg-card-hover">
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

          <div className={cn('flex shrink-0 items-center gap-2', viewMode === 'card' && 'mt-auto self-start')}>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onViewDetails(repository.id)}
            >
              查看详情
              <ChevronRight />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={handleArchive}
              disabled={archiveMutation.isPending || deleteMutation.isPending}
              aria-label="归档仓库"
              title="归档仓库"
            >
              <Archive />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => void handleDelete()}
              disabled={archiveMutation.isPending || deleteMutation.isPending || deleteImpactQuery.isFetching}
              aria-label="永久删除仓库"
              title="永久删除仓库"
            >
              <Trash2 />
            </Button>
          </div>
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
