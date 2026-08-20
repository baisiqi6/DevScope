import type { RepoGraphNode } from "@devscope/shared";

/** Phase C cleanup revision：legacy `reference` kind 已随契约删除，仅认目标 token。 */
export function isTechnologyStackGraphNode(
  node: Pick<RepoGraphNode, "kind">,
): boolean {
  return node.kind === "technology_stack";
}
