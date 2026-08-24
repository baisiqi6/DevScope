import { describe, expect, it } from 'vitest';
import type { RepositoryGroupTreeNode } from '@devscope/shared';
import {
  findGroupInTree,
  flattenGroupTree,
  getDescendantGroupIds,
  getSiblingGroupIds,
} from './group-tree';

function group(
  id: number,
  parentId: number | null,
  children: RepositoryGroupTreeNode[] = [],
): RepositoryGroupTreeNode {
  return {
    id,
    userId: 1,
    parentId,
    name: `group-${id}`,
    color: 'blue',
    icon: 'folder',
    description: null,
    orderIndex: 0,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    repoCount: 0,
    directRepoCount: 0,
    aggregateRepoCount: 0,
    children,
  };
}

describe('group tree helpers', () => {
  const grandchild = group(3, 2);
  const child = group(2, 1, [grandchild]);
  const root = group(1, null, [child]);
  const otherRoot = group(4, null);
  const tree = [root, otherRoot];

  it('以稳定深度顺序展开树', () => {
    expect(flattenGroupTree(tree).map(({ group: item, depth }) => [item.id, depth]))
      .toEqual([[1, 0], [2, 1], [3, 2], [4, 0]]);
  });

  it('定位节点、后代和同级集合', () => {
    expect(findGroupInTree(tree, 3)?.name).toBe('group-3');
    expect(getDescendantGroupIds(root)).toEqual(new Set([2, 3]));
    expect(getSiblingGroupIds(tree, null)).toEqual([1, 4]);
    expect(getSiblingGroupIds(tree, 1)).toEqual([2]);
  });
});
