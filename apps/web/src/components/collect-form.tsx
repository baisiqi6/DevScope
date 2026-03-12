/**
 * @package @devscope/web
 * @description 仓库采集表单组件
 *
 * 用于触发 GitHub 仓库数据采集的表单。
 */

"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";

interface CollectFormProps {
  onCollected: () => void;
}

export function CollectForm({ onCollected }: CollectFormProps) {
  const [repo, setRepo] = useState("");
  const [isCollecting, setIsCollecting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const collectMutation = trpc.collectRepository.useMutation({
    onSuccess: (data) => {
      setIsCollecting(false);
      setResult({
        success: data.status === "completed",
        message: `采集完成！收集了 ${data.chunksCollected} 个文本块，生成 ${data.embeddingsGenerated} 个向量嵌入。`,
      });
      if (data.status === "completed") {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repo.trim()) return;

    setIsCollecting(true);
    setResult(null);
    collectMutation.mutate({ repo: repo.trim() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>采集 GitHub 仓库数据</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="repo-input" className="block text-sm font-medium mb-2">
              仓库地址 (格式: owner/repo)
            </label>
            <input
              id="repo-input"
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="例如: vercel/next.js"
              className="w-full px-3 py-2 border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={isCollecting}
            />
          </div>
          <Button type="submit" disabled={isCollecting || !repo.trim()} className="w-full">
            {isCollecting ? "采集中..." : "开始采集"}
          </Button>
          {result && (
            <div
              className={`p-3 rounded-md text-sm ${
                result.success
                  ? "bg-green-50 text-green-800 border border-green-200"
                  : "bg-red-50 text-red-800 border border-red-200"
              }`}
            >
              {result.message}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
