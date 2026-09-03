import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { ExternalResource } from "@devscope/shared";
import { ResourceCard } from "./external-resource-workspace";

const resource: ExternalResource = {
  id: 1,
  resourceType: "website",
  url: "https://example.com/ui-kit",
  canonicalUrl: "https://example.com/ui-kit",
  title: "UI Kit",
  description: "A useful collection of UI materials.",
  siteName: "Example",
  author: null,
  publishedAt: null,
  faviconUrl: null,
  previewImageUrl: null,
  metadata: null,
  ingestionMode: "preview_only",
  contentStatus: "not_requested",
  contentFetchedAt: null,
  contentError: null,
  notes: "Review later",
  tags: ["ui"],
  isRead: false,
  isPinned: true,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

describe("ExternalResourceWorkspace card", () => {
  it("renders preview fallback, metadata and a safe external link", () => {
    const html = renderToStaticMarkup(
      <ResourceCard
        resource={resource}
        groups={[]}
        density="grid"
        pending={false}
        onAddToGroup={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleRead={vi.fn()}
        onTogglePinned={vi.fn()}
      />,
    );

    expect(html).toContain("UI Kit");
    expect(html).toContain("#ui");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("E");
  });

  it("为显式正文资源显示采集和查看入口", () => {
    const html = renderToStaticMarkup(
      <ResourceCard
        resource={{ ...resource, ingestionMode: "content", contentStatus: "failed", contentError: "transient_failure" }}
        groups={[]}
        density="grid"
        pending={false}
        onAddToGroup={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onToggleRead={vi.fn()}
        onTogglePinned={vi.fn()}
        onRequestContent={vi.fn()}
        onReadContent={vi.fn()}
      />,
    );

    expect(html).toContain("重试正文");
    expect(html).toContain("正文：failed");
  });
});
