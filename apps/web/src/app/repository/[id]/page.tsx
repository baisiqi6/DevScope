/**
 * @package @devscope/web
 * @description 仓库详情页面
 *
 * 显示单个仓库的详细信息和采集统计。
 */

"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface RepositoryDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

/**
 * 仓库详情内容组件
 * 只在 id 有效时才渲染，避免 tRPC 查询验证问题
 */
function RepositoryDetailContent({ id }: { id: number }) {
  const router = useRouter();

  const { data: repository, isLoading, error } = trpc.getRepository.useQuery(
    { id },
    {
      retry: false,
    }
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (error || !repository) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-500 mb-4">
            {error?.message || "仓库不存在"}
          </h1>
          <Button onClick={() => router.push("/")}>返回首页</Button>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" onClick={() => router.push("/")}>
            ← 返回列表
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* 仓库基本信息 */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div>
                <a
                  href={repository.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800"
                >
                  {repository.owner}/{repository.name}
                </a>
                {repository.language && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground bg-muted px-2 py-1 rounded">
                    {repository.language}
                  </span>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {repository.description && (
              <p className="text-muted-foreground mb-4">{repository.description}</p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Stars</div>
                <div className="text-xl font-semibold">{repository.stars.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Forks</div>
                <div className="text-xl font-semibold">{repository.forks.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Open Issues</div>
                <div className="text-xl font-semibold">{repository.openIssues.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted-foreground">License</div>
                <div className="text-xl font-semibold">{repository.license || "N/A"}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 采集统计 */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>数据采集统计</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-muted-foreground text-sm">总文本块</div>
                <div className="text-2xl font-bold">{repository.chunkStats.total}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-sm">README 分块</div>
                <div className="text-2xl font-bold">{repository.chunkStats.readme}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-sm">Issues 分块</div>
                <div className="text-2xl font-bold">{repository.chunkStats.issues}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-sm">Commits 分块</div>
                <div className="text-2xl font-bold">{repository.chunkStats.commits}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* README 预览 */}
        {repository.readme && (
          <Card>
            <CardHeader>
              <CardTitle>README 预览</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted p-4 rounded-md max-h-96 overflow-y-auto">
                <pre className="text-sm whitespace-pre-wrap">{repository.readme.slice(0, 2000)}</pre>
                {repository.readme.length > 2000 && (
                  <div className="text-sm text-muted-foreground mt-2">
                    ... (内容过长，已截断)
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

export default function RepositoryDetailPage({ params }: RepositoryDetailPageProps) {
  const [id, setId] = useState<number | null>(null);

  useEffect(() => {
    params.then((p) => setId(parseInt(p.id, 10)));
  }, [params]);

  if (id === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-center text-muted-foreground">加载中...</div></div>}>
      <RepositoryDetailContent id={id} />
    </Suspense>
  );
}
