/** 已完成健康报告的独立查看页。 */

"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AnimatedBackground } from "@/components/animated-background";
import { HealthReportView } from "@/components/health-report-view";
import { Button } from "@/components/ui/button";

interface HealthReportDetailPageProps {
  params: Promise<{ executionId: string }>;
}

export default function HealthReportDetailPage({ params }: HealthReportDetailPageProps) {
  const { executionId } = use(params);

  return (
    <main className="min-h-screen">
      <AnimatedBackground />

      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <ArrowLeft aria-hidden="true" />
              返回仓库列表
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">健康度报告</h1>
        </div>
        <HealthReportView reportId={executionId} executionId={executionId} />
      </div>
    </main>
  );
}
