/**
 * @package @devscope/web/components
 * @description 未分组仓库侧拉栏组件
 *
 * 在屏幕右侧显示，鼠标悬停时展开并推挤页面内容。
 *
 * @module ungrouped-sidebar
 */

"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { FolderOpen, ChevronRight } from "lucide-react";
import { Card } from "./ui/card";
import type { Repository } from "@devscope/shared";
import { Badge } from "./ui/badge";

interface UngroupedSidebarProps {
  /** 未分组仓库列表 */
  ungroupedRepos: Repository[];
  /** 点击查看仓库详情 */
  onViewDetails: (id: number) => void;
  /** 是否展开（外部控制） */
  isOpen?: boolean;
  /** 展开状态改变回调 */
  onOpenChange?: (open: boolean) => void;
}

/**
 * 未分组仓库侧拉栏组件
 */
export function UngroupedSidebar({
  ungroupedRepos,
  onViewDetails,
  isOpen: controlledIsOpen,
  onOpenChange,
}: UngroupedSidebarProps) {
  // 使用内部状态，但如果外部提供了 controlledIsOpen，则使用外部状态
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isHovered = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;

  const handleMouseEnter = () => {
    if (onOpenChange) {
      onOpenChange(true);
    } else {
      setInternalIsOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (onOpenChange) {
      onOpenChange(false);
    } else {
      setInternalIsOpen(false);
    }
  };

  const hasUngrouped = ungroupedRepos.length > 0;

  return (
    <motion.div
      className="fixed right-0 top-0 h-screen z-40 flex"
      initial={false}
      animate={{
        width: isHovered ? 380 : 60,
      }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 侧拉栏内容 */}
      <motion.div
        className="h-full bg-white border-l-2 border-amber-300 shadow-2xl overflow-hidden"
        initial={false}
        animate={{
          width: isHovered ? 320 : 0,
          opacity: isHovered ? 1 : 0,
        }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
        <div className="h-full flex flex-col">
          {/* 头部 */}
          <div className="sticky top-0 z-10 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-amber-600" />
                <div>
                  <h3 className="font-semibold text-amber-900 text-sm">未分组仓库</h3>
                  <p className="text-xs text-amber-700">共 {ungroupedRepos.length} 个</p>
                </div>
              </div>
              <Badge className="bg-amber-500 text-white hover:bg-amber-600 text-xs">
                {ungroupedRepos.length}
              </Badge>
            </div>
          </div>

          {/* 仓库列表 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {ungroupedRepos.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-amber-600/60">
                <FolderOpen className="h-10 w-10 mb-2" />
                <p className="text-sm">暂无未分组仓库</p>
              </div>
            ) : (
              ungroupedRepos.map((repo) => (
                <motion.div
                  key={repo.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  className="group"
                >
                  <Card
                    className="p-3 border border-gray-200 bg-white hover:bg-amber-50 hover:border-amber-300 transition-all cursor-pointer shadow-sm hover:shadow"
                    onClick={() => onViewDetails(repo.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-gray-900 truncate group-hover:text-amber-700 transition-colors">
                          {repo.owner}/{repo.name}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {repo.language && (
                            <span className="text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                              {repo.language}
                            </span>
                          )}
                          <span className="text-xs text-gray-500 flex items-center gap-0.5">
                            <span>⭐</span>
                            <span>{repo.stars.toLocaleString()}</span>
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-amber-600 transition-colors shrink-0 mt-1" />
                    </div>
                  </Card>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </motion.div>

      {/* 收起状态的标签按钮 */}
      <div
        className={`
          self-center w-[60px] flex flex-col items-center justify-center gap-3 py-4
          border-l border-t border-b border-amber-400
          bg-gradient-to-b from-amber-500 to-orange-500 shadow-lg cursor-pointer
          rounded-l-2xl
          relative
        `}
      >
        {/* 图标 */}
        <FolderOpen className="h-6 w-6 text-white shrink-0" />

        {/* 竖排文字 */}
        <span className="text-white text-sm font-medium" style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}>
          未分组
        </span>

        {/* 数量徽章 */}
        <Badge
          className={`
            text-white font-bold text-xs
            ${hasUngrouped ? 'bg-white/30' : 'bg-white/20'}
          `}
        >
          {ungroupedRepos.length}
        </Badge>

        {/* 提示箭头 - 收起时显示 */}
        {!isHovered && hasUngrouped && (
          <motion.div
            animate={{ x: [0, 5, 0], opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <ChevronRight className="h-4 w-4 text-white/80" />
          </motion.div>
        )}

        {/* 脉冲效果 - 有未分组仓库时 */}
        {!isHovered && hasUngrouped && (
          <>
            <motion.div
              className="absolute inset-0 bg-white/20"
              animate={{ scale: [1, 1.02, 1], opacity: [0, 0.3, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <div className="absolute top-4 right-4">
              <motion.div
                className="h-2 w-2 rounded-full bg-white"
                animate={{ scale: [1, 1.3, 1], opacity: [1, 0.7, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
