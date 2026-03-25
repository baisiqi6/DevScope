/**
 * @package @devscope/web
 * @description 仓库卡片组件
 *
 * 展示单个 GitHub 仓库的信息卡片，支持卡片和列表两种视图模式。
 */

"use client";

import type { Repository } from "@devscope/shared";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { motion } from "framer-motion";
import type { ViewMode } from "./view-toggle";

interface RepositoryCardProps {
  repository: Repository;
  onViewDetails: (id: number) => void;
  viewMode?: ViewMode;
}

export function RepositoryCard({ repository, onViewDetails, viewMode = "card" }: RepositoryCardProps) {
  // 卡片模式 - 紧凑的方片布局
  if (viewMode === "card") {
    return (
      <motion.div
        whileHover={{ y: -4, scale: 1.01, transition: { duration: 0.2 } }}
        className="h-full"
      >
        <Card className="h-full bg-gradient-to-br from-white/90 to-blue-50/30 backdrop-blur-md border border-slate-200/60 shadow-lg shadow-slate-200/50 hover:shadow-xl hover:shadow-blue-200/30 transition-all duration-300 overflow-hidden group">
          {/* 顶部装饰条 */}
          <div className="h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />

          <CardHeader className="pb-3">
            <CardTitle className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <a
                  href={repository.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 font-semibold text-base transition-colors block truncate"
                >
                  {repository.owner}/{repository.name}
                </a>
                {repository.language && (
                  <span className="inline-block mt-2 text-xs font-medium text-blue-700 bg-blue-100/80 px-2.5 py-1 rounded-full">
                    {repository.language}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onViewDetails(repository.id)}
                className="hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all shrink-0"
              >
                查看详情
              </Button>
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            {/* 统计信息网格 */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg p-2.5 text-center border border-amber-100/60">
                <div className="text-lg">⭐</div>
                <div className="text-sm font-bold text-amber-700">{repository.stars.toLocaleString()}</div>
                <div className="text-xs text-amber-600/70">Stars</div>
              </div>
              <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg p-2.5 text-center border border-blue-100/60">
                <div className="text-lg">🔱</div>
                <div className="text-sm font-bold text-blue-700">{repository.forks.toLocaleString()}</div>
                <div className="text-xs text-blue-600/70">Forks</div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-2.5 text-center border border-green-100/60">
                <div className="text-lg">📋</div>
                <div className="text-sm font-bold text-green-700">{repository.openIssues.toLocaleString()}</div>
                <div className="text-xs text-green-600/70">Issues</div>
              </div>
            </div>

            {/* 底部信息 */}
            <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100/60">
              {repository.license && (
                <span className="text-slate-600 bg-slate-100/60 px-2 py-1 rounded-full">
                  ©️ {repository.license}
                </span>
              )}
              {repository.lastFetchedAt && (
                <span className="text-slate-500">
                  更新于 {new Date(repository.lastFetchedAt).toLocaleDateString("zh-CN")}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  // 列表模式 - 优化的行样式
  return (
    <motion.div
      whileHover={{ x: 4, transition: { duration: 0.2 } }}
      className="h-full"
    >
      <Card className="h-full bg-gradient-to-r from-white/90 via-blue-50/20 to-white/90 backdrop-blur-md border border-slate-200/60 shadow-md hover:shadow-lg hover:shadow-blue-100/30 transition-all duration-300 overflow-hidden group">
        {/* 左侧装饰条 */}
        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-blue-500 via-indigo-500 to-purple-500 transform scale-y-0 group-hover:scale-y-100 transition-transform duration-300 origin-top" />

        <CardContent className="p-4 pl-6">
          <div className="flex items-center justify-between gap-4">
            {/* 左侧：仓库名称和标签 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <a
                  href={repository.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 font-semibold text-base transition-colors truncate"
                >
                  {repository.owner}/{repository.name}
                </a>
                {repository.language && (
                  <span className="shrink-0 text-xs font-medium text-blue-700 bg-blue-100/80 px-2.5 py-1 rounded-full">
                    {repository.language}
                  </span>
                )}
              </div>

              {/* 统计信息 */}
              <div className="flex items-center gap-5 text-sm">
                <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50/80 px-2.5 py-1 rounded-full">
                  <span>⭐</span>
                  <span className="font-semibold">{repository.stars.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5 text-blue-700 bg-blue-50/80 px-2.5 py-1 rounded-full">
                  <span>🔱</span>
                  <span className="font-semibold">{repository.forks.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5 text-green-700 bg-green-50/80 px-2.5 py-1 rounded-full">
                  <span>📋</span>
                  <span className="font-semibold">{repository.openIssues.toLocaleString()}</span>
                </div>
                {repository.license && (
                  <div className="flex items-center gap-1.5 text-slate-600 bg-slate-100/60 px-2.5 py-1 rounded-full">
                    <span>©️</span>
                    <span className="font-medium">{repository.license}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 右侧：操作按钮和时间 */}
            <div className="flex items-center gap-3 shrink-0">
              {repository.lastFetchedAt && (
                <div className="text-xs text-slate-500 text-right">
                  <div>最后更新</div>
                  <div className="font-medium text-slate-600">
                    {new Date(repository.lastFetchedAt).toLocaleDateString("zh-CN")}
                  </div>
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => onViewDetails(repository.id)}
                className="hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all"
              >
                查看详情
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
