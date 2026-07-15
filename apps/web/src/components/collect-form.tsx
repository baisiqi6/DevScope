/**
 * @package @devscope/web
 * @description 仓库采集表单组件
 *
 * 用于触发 GitHub 仓库数据采集的表单。
 * 采集完成后自动在后台进行向量化，支持实时进度显示。
 */

'use client';

import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { EmbeddingProgress } from './embedding-progress';

interface CollectFormProps {
  onCollected: () => void;
}

export function CollectForm({ onCollected }: CollectFormProps) {
  const [repo, setRepo] = useState('');
  const [isCollecting, setIsCollecting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    repoId?: number;
  } | null>(null);
  const [collectedRepoId, setCollectedRepoId] = useState<number | null>(null);

  const collectMutation = trpc.collectRepository.useMutation({
    onSuccess: (data) => {
      setIsCollecting(false);

      // 处理失败状态
      if (data.status === 'failed') {
        setResult({
          success: false,
          message: `采集失败：${data.error || '未知错误'}\n请检查仓库格式、访问权限和 GitHub Token。`,
        });
        return;
      }

      // 处理成功状态
      const baseMessage = `数据采集完成，共收集 ${data.chunksCollected} 个文本块。`;
      const embeddingMessage = data.embeddingInBackground
        ? `\n向量化正在后台进行，可以先查看仓库信息。`
        : `\n已跳过向量化。`;

      setResult({
        success: true,
        message: baseMessage + embeddingMessage,
        repoId: data.repository?.id,
      });

      if (data.repository?.id) {
        setCollectedRepoId(data.repository.id);
      }

      if (data.status === 'completed') {
        onCollected();
      }
    },
    onError: (error) => {
      setIsCollecting(false);
      setResult({
        success: false,
        message: `采集失败: ${error.message}`,
      });
    },
  });

  // 检查是否有待处理的采集请求（从关注列表传入）
  useEffect(() => {
    const pendingWindow = window as Window & { __pendingCollectRepo?: string };
    const pendingRepo = pendingWindow.__pendingCollectRepo;
    if (pendingRepo) {
      setRepo(pendingRepo);
      pendingWindow.__pendingCollectRepo = undefined;
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repo.trim()) return;

    const repoInput = repo.trim();
    setIsCollecting(true);
    setResult(null);
    setCollectedRepoId(null);
    collectMutation.mutate({ repo: repoInput, skipEmbeddings: false }); // 始终启用后台向量化
  };

  const handleEmbeddingComplete = () => {
    // 向量化完成后刷新消息
    if (result?.repoId) {
      setResult({
        success: true,
        message: '数据采集与向量化均已完成，现在可以使用语义搜索。',
        repoId: result.repoId,
      });
    }
  };

  return (
    <div className="pr-8">
      <h2 className="text-lg font-semibold">采集 GitHub 仓库</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        输入公开仓库的 <code className="font-mono text-xs">owner/repo</code> 或完整
        URL，采集完成后会自动更新列表。
      </p>
      <form onSubmit={handleSubmit} className="mt-5 max-w-3xl space-y-4">
        <div>
          <label htmlFor="repo-input" className="mb-2 block text-sm font-medium">
            仓库地址
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="repo-input"
              type="text"
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              placeholder="例如：vercel/next.js"
              disabled={isCollecting}
              autoComplete="off"
            />
            <Button type="submit" disabled={isCollecting || !repo.trim()}>
              {isCollecting ? '正在采集' : '开始采集'}
            </Button>
          </div>
        </div>
        {result && (
          <div
            role={result.success ? 'status' : 'alert'}
            className={`whitespace-pre-line rounded-md border p-3 text-sm ${
              result.success
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-destructive/30 bg-destructive/5 text-destructive'
            }`}
          >
            {result.message}
          </div>
        )}
        {collectedRepoId && (
          <EmbeddingProgress repoId={collectedRepoId} onComplete={handleEmbeddingComplete} />
        )}
      </form>
    </div>
  );
}
