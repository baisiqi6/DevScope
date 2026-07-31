"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import type { RepoGraphRendererProps } from "@/components/repo-graph-canvas";
import type { GraphRendererMode } from "@/lib/graph-renderer-mode";

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

interface RepoGraphViewProps extends RepoGraphRendererProps {
  mode: GraphRendererMode;
}

/** 条件渲染会卸载未使用的渲染器，确保 3D 的 WebGL 与 RAF 不在后台继续运行。 */
export default function RepoGraphView({ mode, ...props }: RepoGraphViewProps) {
  return mode === "3d" ? <RepoGraphCanvas3D {...props} /> : <RepoGraphCanvas {...props} />;
}
