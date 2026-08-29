import type { RepositoryGroupTreeNode } from '@devscope/shared';

export interface FlatGroupTreeEntry {
  group: RepositoryGroupTreeNode;
  depth: number;
}

export function flattenGroupTree(
  groups: RepositoryGroupTreeNode[],
  depth = 0,
): FlatGroupTreeEntry[] {
  return groups.flatMap((group) => [
    { group, depth },
    ...flattenGroupTree(group.children, depth + 1),
  ]);
}

export function getDescendantGroupIds(group: RepositoryGroupTreeNode): Set<number> {
  const ids = new Set<number>();
  for (const child of group.children) {
    ids.add(child.id);
    for (const id of getDescendantGroupIds(child)) ids.add(id);
  }
  return ids;
}

export function findGroupInTree(
  groups: RepositoryGroupTreeNode[],
  groupId: number,
): RepositoryGroupTreeNode | null {
  for (const group of groups) {
    if (group.id === groupId) return group;
    const nested = findGroupInTree(group.children, groupId);
    if (nested) return nested;
  }
  return null;
}

export function getSiblingGroupIds(
  groups: RepositoryGroupTreeNode[],
  parentId: number | null,
): number[] {
  if (parentId === null) return groups.map((group) => group.id);
  return findGroupInTree(groups, parentId)?.children.map((group) => group.id) ?? [];
}
