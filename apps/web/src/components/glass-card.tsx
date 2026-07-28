/**
 * @package @devscope/web
 * @description 卡片组件：语义 token 表面 + hover 微抬升
 *
 * hover 使用 translateY(-2px) 与边框亮度变化（border token），不引入阴影。
 */

"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface GlassCardProps extends Omit<HTMLMotionProps<"div">, "children"> {
  /**
   * 是否启用 hover 微抬升（translateY -2px + 边框提亮）
   */
  hoverLift?: boolean;
  /**
   * 子元素
   */
  children: React.ReactNode;
}

/** 交互 spring 两档之 snappy 档（见 DESIGN.md 动效规范）。 */
const SPRING_SNAPPY = { type: "spring", stiffness: 300, damping: 30 } as const;

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, hoverLift = false, children, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        whileHover={hoverLift ? { y: -2 } : undefined}
        transition={SPRING_SNAPPY}
        className={cn(
          "relative rounded-lg border border-border/80 bg-card text-card-foreground shadow-none",
          "transition-[border-color,background-color] duration-150",
          hoverLift && "hover:border-border-hover hover:bg-card-hover",
          className
        )}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

GlassCard.displayName = "GlassCard";
