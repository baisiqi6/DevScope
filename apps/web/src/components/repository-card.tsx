/**
 * @package @devscope/web
 * @description 仓库卡片组件
 *
 * 展示单个 GitHub 仓库的信息卡片。
 */

import type { Repository } from "@devscope/shared";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";

interface RepositoryCardProps {
  repository: Repository;
  onViewDetails: (id: number) => void;
}

export function RepositoryCard({ repository, onViewDetails }: RepositoryCardProps) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div>
            <a
              href={repository.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 font-semibold"
            >
              {repository.owner}/{repository.name}
            </a>
            {repository.language && (
              <span className="ml-2 text-xs font-normal text-muted-foreground bg-muted px-2 py-1 rounded">
                {repository.language}
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onViewDetails(repository.id)}
          >
            查看详情
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {repository.description && (
          <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
            {repository.description}
          </p>
        )}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <span>⭐</span>
            <span>{repository.stars.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1">
            <span>🔱</span>
            <span>{repository.forks.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1">
            <span>📋</span>
            <span>{repository.openIssues.toLocaleString()}</span>
          </div>
          {repository.license && (
            <div className="flex items-center gap-1">
              <span>©️</span>
              <span>{repository.license}</span>
            </div>
          )}
        </div>
        {repository.lastFetchedAt && (
          <div className="mt-2 text-xs text-muted-foreground">
            最后更新: {new Date(repository.lastFetchedAt).toLocaleString("zh-CN")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
