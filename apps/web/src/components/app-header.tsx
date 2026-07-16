"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Navigation } from "@/components/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export function AppHeader() {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        跳到主要内容
      </a>
      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/95 supports-[backdrop-filter]:bg-background/90 supports-[backdrop-filter]:backdrop-blur-sm">
        <div className="container mx-auto flex min-h-16 items-center justify-between gap-4 px-4">
          <Link
            href="/"
            aria-label="DevScope 仓库列表"
            onClick={() => setIsMenuOpen(false)}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md text-lg font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="relative flex h-8 w-8 items-center justify-center rounded-md border border-primary/45 bg-primary/10 text-sm font-bold text-primary">
              <span aria-hidden="true">DS</span>
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full border border-background bg-signal shadow-[0_0_10px_oklch(var(--signal)/0.7)]" />
            </span>
            <span className="flex items-center gap-2">
              <span>DevScope</span>
              <span className="hidden rounded border border-border/80 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground lg:inline-flex">
                研究终端
              </span>
            </span>
          </Link>

          <Navigation className="hidden md:flex" />

          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label={isMenuOpen ? "收起导航" : "展开导航"}
              aria-controls="mobile-navigation"
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen((open) => !open)}
            >
              {isMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </Button>
          </div>
        </div>

        {isMenuOpen && (
          <div id="mobile-navigation" className="border-t border-border/80 bg-background px-4 py-3 md:hidden">
            <Navigation mobile />
          </div>
        )}
      </header>
    </>
  );
}
