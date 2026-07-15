/** 已完成健康报告的独立查看页。 */

"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AnimatedBackground } from "@/components/animated-background";
import { HealthReportView } from "@/components/health-report-view";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";

interface HealthReportDetailPageProps {
  params: Promise<{ executionId: string }>;
}

export default function HealthReportDetailPage({ params }: HealthReportDetailPageProps) {
  const { executionId } = use(params);

  return (
    <main className="min-h-screen">
      <AnimatedBackground />

      <header className="sticky top-0 z-50 border-b border-slate-200/60 bg-white/70 backdrop-blur-md">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/">
                <ArrowLeft data-icon="inline-start" />
                返回仓库列表
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">健康度报告</h1>
          </div>
          <Navigation />
        </div>
      </header>

      <div className="container mx-auto max-w-5xl px-4 py-8">
        <HealthReportView reportId={executionId} executionId={executionId} />
      </div>
    </main>
  );
}
