/** 全局主导航，桌面端横向排列，移动端纵向排列。 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Activity, Bookmark, Compass, FolderOpen, LayoutGrid, Network, Search, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", label: "仓库列表", icon: LayoutGrid },
  { path: "/resources", label: "外部资源", icon: Bookmark },
  { path: "/groups", label: "分组管理", icon: FolderOpen },
  { path: "/discover", label: "发现", icon: Compass },
  { path: "/search", label: "语义搜索", icon: Search },
  { path: "/graph", label: "关系图谱", icon: Network },
  { path: "/analysis/competitive", label: "竞争分析", icon: TrendingUp },
  { path: "/analysis/health", label: "健康度报告", icon: Activity },
];

/** 交互 spring 两档之 snappy 档（见 DESIGN.md 动效规范）。 */
const SPRING_SNAPPY = { type: "spring", stiffness: 300, damping: 30 } as const;

interface NavigationProps {
  className?: string;
  mobile?: boolean;
}

function isActivePath(pathname: string, path: string) {
  if (path === "/") {
    return pathname === "/" || pathname.startsWith("/repository/") || pathname === "/repo-stats";
  }

  return pathname === path || pathname.startsWith(`${path}/`);
}

export function Navigation({ className, mobile = false }: NavigationProps) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <nav
      aria-label="主导航"
      className={cn(mobile ? "grid gap-1" : "flex items-center gap-1", className)}
    >
      {navItems.map((item) => {
        const isActive = isActivePath(pathname, item.path);
        const Icon = item.icon;

        return (
          <Link
            key={item.path}
            href={item.path}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative inline-flex min-h-10 items-center gap-2 rounded-md border border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              mobile && "w-full justify-start",
              isActive ? "text-primary" : "hover:bg-accent hover:text-foreground"
            )}
          >
            {isActive &&
              (reduceMotion ? (
                <span className="absolute inset-0 -z-10 rounded-md border border-primary/20 bg-primary/10" />
              ) : (
                <motion.span
                  layoutId={`nav-indicator-${mobile ? "mobile" : "desktop"}`}
                  transition={SPRING_SNAPPY}
                  className="absolute inset-0 -z-10 rounded-md border border-primary/20 bg-primary/10"
                />
              ))}
            <Icon aria-hidden="true" className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
