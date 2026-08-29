import { ExternalResourceWorkspace } from "@/components/external-resource-workspace";
import React from "react";

export const metadata = {
  title: "外部资源 | DevScope",
  description: "管理文章、论文和网站的预览收藏",
};

export default function ResourcesPage() {
  return <ExternalResourceWorkspace />;
}
