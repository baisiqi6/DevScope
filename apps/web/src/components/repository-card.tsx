/**
 * @package @devscope/web/components
 * @description 仓库卡片组件
 *
 * 展示单个仓库的关键信息，支持用户自定义备注。
 */

"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import { Pencil, Check, X } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface RepositoryCardProps {
  id: number;
  fullName: string;
  description?: string;
  note?: string;
  stars?: number;
  forks?: number;
  language?: string;
  license?: string;
  lastFetchedAt?: string;
  starredAt?: string;
  onClick?: () => void;
}

export function RepositoryCard({
  id,
  fullName,
  description,
  note,
  stars,
  forks,
  language,
  license,
  lastFetchedAt,
  starredAt,
  onClick,
}: RepositoryCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(note || "");
  const updateNoteMutation = trpc.updateRepoNote.useMutation({
    onSuccess: () => {
      setIsEditing(false);
    },
  });

  const displayText = note || description;

  const handleSaveNote = () => {
    updateNoteMutation.mutate({ repoId: id, note: editValue });
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditValue(note || "");
  };

  return (
    <div
      className="p-4 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm truncate">{fullName}</h3>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {stars !== undefined && (
            <span className="text-xs text-muted-foreground">⭐ {stars.toLocaleString()}</span>
          )}
        </div>
      </div>

      {/* 简介区域 */}
      <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
        {isEditing ? (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveNote();
                if (e.key === "Escape") handleCancelEdit();
              }}
              placeholder="添加备注..."
              className="flex-1 text-xs border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0"
              onClick={handleSaveNote}
              disabled={updateNoteMutation.isLoading}
            >
              <Check className="h-3 w-3 text-green-600" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0"
              onClick={handleCancelEdit}
            >
              <X className="h-3 w-3 text-red-400" />
            </Button>
          </div>
        ) : (
          <div className="flex items-start gap-1 group">
            {displayText ? (
              <p className="text-xs text-muted-foreground line-clamp-2 flex-1">
                {displayText}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground/50 italic flex-1">
                暂无简介
              </p>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => {
                setEditValue(note || "");
                setIsEditing(true);
              }}
              title={note ? "编辑备注" : "添加备注"}
            >
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
        )}
      </div>

      {/* 标签区域 */}
      <div className="flex flex-wrap gap-2 mt-2">
        {language && (
          <span className="inline-flex items-center text-xs text-muted-foreground">
            🔷 {language}
          </span>
        )}
        {forks !== undefined && forks > 0 && (
          <span className="inline-flex items-center text-xs text-muted-foreground">
            🔱 {forks.toLocaleString()}
          </span>
        )}
        {license && (
          <span className="inline-flex items-center text-xs text-muted-foreground">
            📄 {license}
          </span>
        )}
        {starredAt && (
          <span className="inline-flex items-center text-xs text-muted-foreground">
            ⭐ 关注 {new Date(starredAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}
