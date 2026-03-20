/**
 * @package @devscope/web
 * @description 玻璃态卡片组件
 *
 * 提供现代的玻璃态效果，带有渐变边框、阴影和 hover 动画。
 */

"use client";

import { motion } from "framer-motion";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * 是否显示渐变边框
   */
  gradientBorder?: boolean;
  /**
   * 悬停时是否放大
   */
  hoverScale?: boolean;
  /**
   * 子元素
   */
  children: React.ReactNode;
}

/**
 * 玻璃态卡片组件
 * 结合了背景模糊、半透明和渐变边框效果
 */
export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, gradientBorder = true, hoverScale = false, children, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={hoverScale ? { scale: 1.02 } : {}}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={cn(
          // 基础样式
          "relative rounded-xl",
          // 背景效果
          "bg-white/80 backdrop-blur-md",
          // 阴影
          "shadow-lg shadow-slate-200/50",
          "hover:shadow-xl hover:shadow-slate-300/50",
          "transition-shadow duration-300",
          className
        )}
        {...props}
      >
        {/* 渐变边框效果 */}
        {gradientBorder && (
          <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-100 via-indigo-100 to-purple-100 opacity-0 hover:opacity-100 transition-opacity duration-500 -z-10" />
        )}

        {children}
      </motion.div>
    );
  }
);

GlassCard.displayName = "GlassCard";
