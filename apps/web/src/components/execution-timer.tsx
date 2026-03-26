/**
 * @package @devscope/web/components
 * @description 执行计时器组件
 *
 * 显示 Agent 执行时间，实时更新
 */

"use client";

import { useEffect, useState, useRef } from "react";
import { Clock } from "lucide-react";

// ============================================================================
// 类型定义
// ============================================================================

interface ExecutionTimerProps {
  /** 是否正在运行 */
  isRunning: boolean;
  /** 开始时间（可选，默认为组件挂载时间） */
  startTime?: number;
  /** 自定义样式类名 */
  className?: string;
}

// ============================================================================
// 组件
// ============================================================================

/**
 * 格式化时间为 MM:SS 格式
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * 执行计时器组件
 *
 * @param props - 组件属性
 * @returns JSX 元素
 *
 * @example
 * ```tsx
 * <ExecutionTimer isRunning={status === "running"} />
 * ```
 */
export function ExecutionTimer({
  isRunning,
  startTime,
  className = "",
}: ExecutionTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startRef = useRef<number>(startTime ?? Date.now());

  // 启动计时器
  useEffect(() => {
    if (isRunning) {
      startRef.current = startTime ?? Date.now();

      // 立即更新一次
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));

      // 每秒更新
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
      }, 1000);
    } else {
      // 停止计时器
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    // 清理
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, startTime]);

  // 根据执行时间显示不同的颜色
  const getTimeColor = () => {
    if (elapsed < 30) return "text-blue-600";
    if (elapsed < 60) return "text-yellow-600";
    return "text-orange-600";
  };

  // 根据执行时间显示提示
  const getTimeHint = () => {
    if (elapsed < 30) return null;
    if (elapsed < 60) return "分析进行中...";
    return "分析较复杂，请耐心等待...";
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Clock className={`h-4 w-4 ${isRunning ? "animate-pulse" : ""} ${getTimeColor()}`} />
      <span className={`font-mono font-medium ${getTimeColor()}`}>
        {formatTime(elapsed)}
      </span>
      {isRunning && getTimeHint() && (
        <span className="text-sm text-gray-500">{getTimeHint()}</span>
      )}
    </div>
  );
}
