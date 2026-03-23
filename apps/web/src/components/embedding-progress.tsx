/**
 * 向量化进度条组件
 * @description 显示仓库向量化的实时进度
 */

import { useEffect, useState } from "react";
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

  const { data: statusData } = trpc.getEmbeddingStatus.useQuery(
    { repoId: repoId! },
    {
      enabled: repoId !== null,
      refetchInterval: (data) => {
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

      // 如果完成，触发回调
      if (statusData.status === 'completed' && onComplete) {
        onComplete();
      }
    }
  }, [statusData, onComplete]);

  if (!repoId || !status) {
    return null;
  }

  // 如果已完成且进度 100%，不显示（让调用者显示完成消息）
  if (status.status === 'completed' && status.progress === 100) {
    return null;
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        {status.status === 'processing' && (
          <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
        )}
        {status.status === 'completed' && (
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        )}
        {status.status === 'failed' && (
          <AlertCircle className="h-5 w-5 text-red-500" />
        )}
        {status.status === 'pending' && (
          <Loader2 className="h-5 w-5 text-gray-400 animate-spin" />
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
            <p className="text-xs text-red-500 mt-2">{status.error}</p>
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
      refetchInterval: (data) => {
        if (data?.status === 'processing') return 2000;
        if (data?.status === 'completed' || data?.status === 'failed') return false;
        return 5000;
      },
    }
  );

  if (!data) return null;

  if (data.status === 'completed') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        <span className="text-sm text-green-700 dark:text-green-300">
          向量化完成，可使用语义搜索
        </span>
      </div>
    );
  }

  if (data.status === 'processing') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <Loader2 className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin" />
        <span className="text-sm text-blue-700 dark:text-blue-300">
          向量化中 {data.progress}%
        </span>
      </div>
    );
  }

  if (data.status === 'failed') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
        <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
        <span className="text-sm text-red-700 dark:text-red-300">
          向量化失败{data.error ? `: ${data.error}` : ''}
        </span>
      </div>
    );
  }

  return null;
}
