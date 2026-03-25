/**
 * @package @devscope/web
 * @description Navigation 组件
 *
 * 提供统一的导航栏，支持激活状态指示。
 */

"use client";

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LayoutGrid, Search, TrendingUp } from "lucide-react";

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();

  const navItems = [
    { path: "/", label: "仓库列表", icon: LayoutGrid },
    { path: "/search", label: "语义搜索", icon: Search },
    { path: "/analysis/competitive", label: "竞争分析", icon: TrendingUp },
  ];

  return (
    <nav className="flex gap-2">
      {navItems.map((item) => {
        const isActive = pathname === item.path;
        const Icon = item.icon;

        return (
          <Button
            key={item.path}
            variant={isActive ? "default" : "ghost"}
            onClick={() => router.push(item.path)}
            className={`relative ${
              isActive
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "hover:bg-blue-50 hover:text-blue-600"
            } transition-colors`}
          >
            <Icon className="h-4 w-4" />
            {item.label}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />
            )}
          </Button>
        );
      })}
    </nav>
  );
}
