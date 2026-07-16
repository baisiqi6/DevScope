/**
 * 向量化进度条组件
 * @description 显示仓库向量化的实时进度
 */

import { useEffect, useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

interface EmbeddingProgressProps {
  repoId: number | null;
  onComplete?: () => void;
}

export function EmbeddingProgress({ repoId, onComplete }: EmbeddingProgressProps) {
  const [status, setStatus] = useState<{
    progress: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    error: string | null;
  } | null>(null);

  // 使用 ref 存储 onComplete，避免依赖变化导致循环
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const { data: statusData } = trpc.getEmbeddingStatus.useQuery(
    { repoId: repoId! },
    {
      enabled: repoId !== null,
      refetchInterval: (query) => {
        const data = query.state.data;
        // 如果正在处理中，每 2 秒轮询一次
        if (data?.status === 'processing') {
          return 2000;
        }
        // 如果已完成或失败，停止轮询
        if (data?.status === 'completed' || data?.status === 'failed') {
          return false;
        }
        // 如果是 pending，每 3 秒轮询一次
        return 3000;
      },
    }
  );

  useEffect(() => {
    if (statusData) {
      setStatus({
        progress: statusData.progress,
        status: statusData.status,
        error: statusData.error,
      });

      // 如果完成，触发回调（使用 ref 避免依赖问题）
      if (statusData.status === 'completed' && onCompleteRef.current) {
        onCompleteRef.current();
      }
    }
  }, [statusData]); // 移除 onComplete 依赖

  if (!repoId || !status) {
    return null;
  }

  // 如果已完成且进度 100%，不显示（让调用者显示完成消息）
  if (status.status === 'completed' && status.progress === 100) {
    return null;
  }

  // 如果是 pending 状态且进度为 0%，不显示（未开始的状态）
  if (status.status === 'pending' && status.progress === 0) {
    return null;
  }

  return (
    <Card
      className="hologram-panel p-4"
      data-live={status.status === 'processing' ? 'true' : 'false'}
    >
      <div className="relative z-20 flex items-center gap-3">
        {status.status === 'processing' && (
          <Loader2 className="h-5 w-5 animate-spin text-signal motion-reduce:animate-none" />
        )}
        {status.status === 'completed' && (
          <CheckCircle2 className="h-5 w-5 text-success" />
        )}
        {status.status === 'failed' && (
          <AlertCircle className="h-5 w-5 text-destructive" />
        )}
        {status.status === 'pending' && (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
        )}

        <div className="flex-1">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium">
              {status.status === 'pending' && "准备向量化..."}
              {status.status === 'processing' && `向量化中... ${status.progress}%`}
              {status.status === 'completed' && "向量化完成"}
              {status.status === 'failed' && "向量化失败"}
            </span>
            <span className="text-xs text-muted-foreground">
              {status.progress}%
            </span>
          </div>
          <Progress value={status.progress} className="h-2" />
          {status.error && (
            <p className="mt-2 text-xs text-destructive">{status.error}</p>
          )}
          {status.status === 'processing' && (
            <p className="text-xs text-muted-foreground mt-1">
              向量化完成后可使用语义搜索功能
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * 向量化状态提示组件
 * @description 在仓库详情页显示向量化状态的简短提示
 */
export function EmbeddingStatusBadge({ repoId }: { repoId: number }) {
  const { data } = trpc.getEmbeddingStatus.useQuery(
    { repoId },
    {
      refetchInterval: (query) => {
        const data = query.state.data;
        if (data?.status === 'processing') return 2000;
        if (data?.status === 'completed' || data?.status === 'failed') return false;
        return 5000;
      },
    }
  );

  if (!data) return null;

  if (data.status === 'completed') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-1.5">
        <CheckCircle2 className="h-4 w-4 text-success" />
        <span className="text-sm text-success">
          向量化完成，可使用语义搜索
        </span>
      </div>
    );
  }

  if (data.status === 'processing') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-signal/30 bg-signal/10 px-3 py-1.5">
        <Loader2 className="h-4 w-4 animate-spin text-signal motion-reduce:animate-none" />
        <span className="text-sm text-signal">
          向量化中 {data.progress}%
        </span>
      </div>
    );
  }

  if (data.status === 'failed') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5">
        <AlertCircle className="h-4 w-4 text-destructive" />
        <span className="text-sm text-destructive">
          向量化失败{data.error ? `: ${data.error}` : ''}
        </span>
      </div>
    );
  }

  return null;
}
