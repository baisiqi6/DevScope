import type { ExternalResource } from "@devscope/shared";

export type ResourceFilter = "all" | ExternalResource["resourceType"];
export type ResourceStatusFilter = "all" | "unread" | "read" | "pinned";

export function filterAndSortExternalResources(
  resources: ExternalResource[],
  options: {
    filter: ResourceFilter;
    statusFilter: ResourceStatusFilter;
    query: string;
    pinnedFirst: boolean;
    groupResourceIds?: ReadonlySet<number>;
  },
) {
  const needle = options.query.trim().toLowerCase();
  return resources
    .filter((resource) => {
      if (options.filter !== "all" && resource.resourceType !== options.filter) return false;
      if (options.statusFilter === "unread" && resource.isRead) return false;
      if (options.statusFilter === "read" && !resource.isRead) return false;
      if (options.statusFilter === "pinned" && !resource.isPinned) return false;
      if (options.groupResourceIds && !options.groupResourceIds.has(resource.id)) return false;
      if (!needle) return true;
      return [resource.title, resource.description, resource.siteName, resource.author, resource.url, ...resource.tags]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle));
    })
    .sort((a, b) => options.pinnedFirst && a.isPinned !== b.isPinned
      ? Number(b.isPinned) - Number(a.isPinned)
      : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
