"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { RepoGraphRendererProps } from "@/components/repo-graph-canvas";

function GraphLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
      图谱组件加载中…
    </div>
  );
}

const RepoGraphCanvas = dynamic(() => import("@/components/repo-graph-canvas"), {
  ssr: false,
  loading: GraphLoading,
});

const RepoGraphCanvas3D = dynamic(() => import("@/components/repo-graph-canvas-3d"), {
  ssr: false,
  loading: GraphLoading,
});

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

interface RenderEnv {
  webgl: boolean;
  coarse: boolean;
}

/**
 * 渲染器选择：桌面且 WebGL 可用时走 3D 星图；
 * reduced-motion、触摸设备、窄视口或 WebGL 不可用时静默回退 2D。
 */
export default function RepoGraphView(props: RepoGraphRendererProps) {
  const [env, setEnv] = useState<RenderEnv | null>(null);

  useEffect(() => {
    setEnv({
      webgl: supportsWebGL(),
      coarse: window.matchMedia("(pointer: coarse)").matches,
    });
  }, []);

  if (!env) return <GraphLoading />;

  const use3D = env.webgl && !props.reducedMotion && !props.isMobile && !env.coarse;
  return use3D ? <RepoGraphCanvas3D {...props} /> : <RepoGraphCanvas {...props} />;
}
