/**
 * @package @devscope/web
 * @description 低干扰页面背景与兼容旧调用的内容容器
 *
 * 环境层由静态细网格 + 鼠标跟随 spotlight 组成：
 * - spotlight 通过 CSS 变量驱动 translate3d，RAF 节流，仅合成器层工作；
 * - 强度 off / subtle / full 持久化在 localStorage（devscope-ambient），SSR 默认 subtle；
 * - 数据密集路由（首页列表 / 搜索页）自动降亮；
 * - prefers-reduced-motion 完全静态，触摸设备退化为中心固定渐变。
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AMBIENT_DEFAULT_LEVEL, AMBIENT_STORAGE_KEY, AMBIENT_CHANGE_EVENT, isAmbientLevel } from "@/lib/ambient";
import type { AmbientLevel } from "@/lib/ambient";

const SPOTLIGHT_SIZE = 1100;
const HALF_SPOTLIGHT = SPOTLIGHT_SIZE / 2;

const LEVEL_OPACITY: Record<AmbientLevel, number> = {
  off: 0,
  subtle: 0.35,
  full: 0.55,
};

/** 数据密集区降亮：首页列表与搜索页。 */
const DIM_ROUTES = ["/", "/search"];
const DIM_FACTOR = 0.12 / 0.35;

export function AnimatedBackground() {
  const pathname = usePathname();
  const spotlightRef = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState<AmbientLevel>(AMBIENT_DEFAULT_LEVEL);
  const [staticMode, setStaticMode] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(AMBIENT_STORAGE_KEY);
      if (isAmbientLevel(stored)) {
        setLevel(stored);
      }
    } catch {
      // localStorage 不可用时保持默认强度
    }
    setStaticMode(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        window.matchMedia("(pointer: coarse)").matches
    );

    // 同页 Header 开关切换时同步（storage 事件不覆盖同标签页）
    const handleAmbientChange = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail;
      if (isAmbientLevel(next)) {
        setLevel(next);
      }
    };
    window.addEventListener(AMBIENT_CHANGE_EVENT, handleAmbientChange);
    return () => window.removeEventListener(AMBIENT_CHANGE_EVENT, handleAmbientChange);
  }, []);

  useEffect(() => {
    if (level === "off" || staticMode) return;

    const element = spotlightRef.current;
    if (!element) return;

    let frame = 0;
    let nextX = window.innerWidth / 2;
    let nextY = window.innerHeight / 3;

    const applyPosition = () => {
      frame = 0;
      element.style.setProperty("--spotlight-x", `${nextX}px`);
      element.style.setProperty("--spotlight-y", `${nextY}px`);
    };

    const handlePointerMove = (event: PointerEvent) => {
      nextX = event.clientX;
      nextY = event.clientY;
      if (!frame) {
        frame = requestAnimationFrame(applyPosition);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [level, staticMode]);

  const dimmed = DIM_ROUTES.includes(pathname);
  const opacity = LEVEL_OPACITY[level] * (dimmed ? DIM_FACTOR : 1);
  const spotlightVisible = level !== "off" && opacity > 0;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, oklch(var(--border) / 0.1) 1px, transparent 1px),
            linear-gradient(to bottom, oklch(var(--border) / 0.1) 1px, transparent 1px),
            linear-gradient(to right, oklch(var(--primary) / 0.025) 1px, transparent 1px),
            linear-gradient(to bottom, oklch(var(--primary) / 0.025) 1px, transparent 1px)
          `,
          backgroundSize: "32px 32px, 32px 32px, 128px 128px, 128px 128px",
        }}
      />
      {spotlightVisible && (
        <div
          ref={spotlightRef}
          className="absolute inset-0 transition-opacity duration-300"
          style={
            {
              opacity,
              "--spotlight-x": "50vw",
              "--spotlight-y": "38vh",
            } as React.CSSProperties
          }
        >
          <div
            className="absolute left-0 top-0 will-change-transform"
            style={{
              width: SPOTLIGHT_SIZE,
              height: SPOTLIGHT_SIZE,
              transform: `translate3d(calc(var(--spotlight-x) - ${HALF_SPOTLIGHT}px), calc(var(--spotlight-y) - ${HALF_SPOTLIGHT}px), 0)`,
              background:
                "radial-gradient(closest-side, oklch(var(--primary) / 0.16), oklch(var(--primary) / 0.05) 45%, transparent 72%)",
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * 保留现有调用接口。产品页面直接进入任务，不再播放整页入场动画。
 */
export function AnimatedPage({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

/**
 * 保留现有列表调用接口。长列表不逐项播放动画，避免拖慢浏览节奏。
 */
export function FadeInItem({
  children,
  className = "",
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}
