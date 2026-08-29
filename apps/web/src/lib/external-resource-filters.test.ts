import { describe, expect, it } from "vitest";
import { filterAndSortExternalResources } from "./external-resource-filters";
import type { ExternalResource } from "@devscope/shared";

const resource = (overrides: Partial<ExternalResource>): ExternalResource => ({
  id: 1,
  resourceType: "article",
  url: "https://example.com/article",
  canonicalUrl: "https://example.com/article",
  title: "Design systems",
  description: "A practical guide",
  siteName: "Example",
  author: "Ada",
  publishedAt: null,
  faviconUrl: null,
  previewImageUrl: null,
  metadata: null,
  ingestionMode: "preview_only",
  contentStatus: "not_requested",
  contentFetchedAt: null,
  contentError: null,
  notes: null,
  tags: ["ui"],
  isRead: false,
  isPinned: false,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
  ...overrides,
});

describe("filterAndSortExternalResources", () => {
  it("按类型、关键词和分组成员筛选，并将置顶资源排在前面", () => {
    const result = filterAndSortExternalResources([
      resource({ id: 1, isPinned: false }),
      resource({ id: 2, resourceType: "paper", title: "Vector search", isPinned: true }),
    ], { filter: "paper", statusFilter: "all", query: "vector", pinnedFirst: true, groupResourceIds: new Set([2]) });
    expect(result.map((item) => item.id)).toEqual([2]);
  });

  it("支持未读和置顶状态筛选", () => {
    const result = filterAndSortExternalResources([
      resource({ id: 1, isRead: false, isPinned: false }),
      resource({ id: 2, isRead: true, isPinned: true }),
    ], { filter: "all", statusFilter: "unread", query: "", pinnedFirst: true });
    expect(result.map((item) => item.id)).toEqual([1]);
  });
});
