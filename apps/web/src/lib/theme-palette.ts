"use client";

import { useEffect, useState } from "react";

export interface ThemePalette {
  primary: string;
  warning: string;
  muted: string;
  foreground: string;
  background: string;
}

export function readPalette(): ThemePalette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    primary: read("--primary"),
    warning: read("--warning"),
    muted: read("--muted-foreground"),
    foreground: read("--foreground"),
    background: read("--background"),
  };
}

export function oklch(triplet: string, alpha: number): string {
  return `oklch(${triplet} / ${alpha})`;
}

export function useThemePalette(): ThemePalette {
  const [palette, setPalette] = useState<ThemePalette>(readPalette);

  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(readPalette()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return palette;
}
