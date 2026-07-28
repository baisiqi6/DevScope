/**
 * @package @devscope/web
 * @description 环境层强度开关，与 ThemeToggle 并列放在共享 Header。
 */

"use client";

import { useEffect, useState } from "react";
import { Contrast, Lightbulb, LightbulbOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AMBIENT_DEFAULT_LEVEL, AMBIENT_STORAGE_KEY, AMBIENT_CHANGE_EVENT } from "@/lib/ambient";
import type { AmbientLevel } from "@/lib/ambient";

const LEVEL_ORDER: AmbientLevel[] = ["off", "subtle", "full"];

const LEVEL_META: Record<AmbientLevel, { label: string; icon: typeof Lightbulb }> = {
  off: { label: "环境光：关闭", icon: LightbulbOff },
  subtle: { label: "环境光：柔和", icon: Lightbulb },
  full: { label: "环境光：完整", icon: Contrast },
};

export function AmbientToggle() {
  const [level, setLevel] = useState<AmbientLevel>(AMBIENT_DEFAULT_LEVEL);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(AMBIENT_STORAGE_KEY);
      if (stored === "off" || stored === "subtle" || stored === "full") {
        setLevel(stored);
      }
    } catch {
      // localStorage 不可用时保持默认强度
    }
  }, []);

  const nextLevel = LEVEL_ORDER[(LEVEL_ORDER.indexOf(level) + 1) % LEVEL_ORDER.length];
  const meta = LEVEL_META[level];
  const Icon = meta.icon;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`${meta.label}，点按切换到${LEVEL_META[nextLevel].label.replace("环境光：", "")}`}
      title={meta.label}
      className="min-w-10 px-2.5 text-muted-foreground"
      onClick={() => {
        setLevel(nextLevel);
        try {
          localStorage.setItem(AMBIENT_STORAGE_KEY, nextLevel);
        } catch {
          // localStorage 不可用时仅本次会话生效
        }
        window.dispatchEvent(new CustomEvent(AMBIENT_CHANGE_EVENT, { detail: nextLevel }));
      }}
    >
      <Icon aria-hidden="true" />
      <span className="hidden xl:inline">
        {level === "off" ? "关闭" : level === "subtle" ? "柔和" : "完整"}
      </span>
    </Button>
  );
}
