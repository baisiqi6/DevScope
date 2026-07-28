/**
 * @package @devscope/web
 * @description 数字滚动组件（useSpring + useInView 的 NumberTicker 模式）
 *
 * tabular-nums 仅在本组件内启用；reduced-motion 下直接呈现最终值。
 */

"use client";

import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";

/** 交互 spring 两档之 soft 档（见 DESIGN.md 动效规范）。 */
const SPRING_SOFT = { stiffness: 180, damping: 20 };

interface NumberTickerProps {
  value: number;
  className?: string;
}

export function NumberTicker({ value, className }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, SPRING_SOFT);
  const isInView = useInView(ref, { once: true, margin: "0px" });

  const formatted = new Intl.NumberFormat("zh-CN").format(value);

  useEffect(() => {
    if (reduceMotion || !isInView) return;
    motionValue.set(value);
  }, [reduceMotion, isInView, value, motionValue]);

  useEffect(() => {
    if (reduceMotion) return;
    const formatter = new Intl.NumberFormat("zh-CN");
    return springValue.on("change", (latest) => {
      if (ref.current) {
        ref.current.textContent = formatter.format(Math.round(latest));
      }
    });
  }, [reduceMotion, springValue]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {reduceMotion ? formatted : 0}
    </span>
  );
}
