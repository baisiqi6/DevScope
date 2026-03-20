/**
 * @package @devscope/web
 * @description 仓库卡片组件
 *
 * 展示单个 GitHub 仓库的信息卡片。
 */

"use client";

import type { Repository } from "@devscope/shared";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { motion } from "framer-motion";

interface RepositoryCardProps {
  repository: Repository;
  onViewDetails: (id: number) => void;
}

export function RepositoryCard({ repository, onViewDetails }: RepositoryCardProps) {
  return (
    <motion.div
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className="h-full"
    >
      <Card className="h-full bg-white/80 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50 hover:shadow-xl hover:shadow-slate-300/50 transition-all duration-300">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div>
              <a
                href={repository.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-800 font-semibold transition-colors"
              >
                {repository.owner}/{repository.name}
              </a>
              {repository.language && (
                <span className="ml-2 text-xs font-normal text-slate-600 bg-blue-50 px-2 py-1 rounded-full">
                  {repository.language}
                </span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onViewDetails(repository.id)}
              className="hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 transition-colors"
            >
              查看详情
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {repository.description && (
            <p className="text-sm text-slate-600 mb-4 line-clamp-2">
              {repository.description}
            </p>
          )}
          <div className="flex gap-4 text-sm text-slate-600">
            <div className="flex items-center gap-1">
              <span className="text-amber-500">⭐</span>
              <span className="font-medium">{repository.stars.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-blue-500">🔱</span>
              <span className="font-medium">{repository.forks.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-green-500">📋</span>
              <span className="font-medium">{repository.openIssues.toLocaleString()}</span>
            </div>
            {repository.license && (
              <div className="flex items-center gap-1">
                <span>©️</span>
                <span className="font-medium">{repository.license}</span>
              </div>
            )}
          </div>
          {repository.lastFetchedAt && (
            <div className="mt-3 text-xs text-slate-500">
              最后更新: {new Date(repository.lastFetchedAt).toLocaleString("zh-CN")}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
