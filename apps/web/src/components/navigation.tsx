/** 全局主导航，桌面端横向排列，移动端纵向排列。 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, FolderOpen, LayoutGrid, Search, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { path: "/", label: "仓库列表", icon: LayoutGrid },
  { path: "/groups", label: "分组管理", icon: FolderOpen },
  { path: "/search", label: "语义搜索", icon: Search },
  { path: "/analysis/competitive", label: "竞争分析", icon: TrendingUp },
  { path: "/analysis/health", label: "健康度报告", icon: Activity },
];

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
              "inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              mobile && "w-full justify-start",
              isActive
                ? "bg-primary/10 text-primary"
                : "hover:bg-accent hover:text-foreground"
            )}
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
