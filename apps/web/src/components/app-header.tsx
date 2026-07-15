"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Navigation } from "@/components/navigation";
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
      <header className="sticky top-0 z-50 border-b bg-background/95 supports-[backdrop-filter]:bg-background/90 supports-[backdrop-filter]:backdrop-blur-sm">
        <div className="container mx-auto flex min-h-16 items-center justify-between gap-4 px-4">
          <Link
            href="/"
            aria-label="DevScope 仓库列表"
            onClick={() => setIsMenuOpen(false)}
            className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md text-lg font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
            >
              DS
            </span>
            <span>DevScope</span>
          </Link>

          <Navigation className="hidden md:flex" />

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

        {isMenuOpen && (
          <div id="mobile-navigation" className="border-t bg-background px-4 py-3 md:hidden">
            <Navigation mobile />
          </div>
        )}
      </header>
    </>
  );
}
