import type { RepoGraphNode } from "@devscope/shared";

/** Phase A: consume both legacy API nodes and the target graph contract. */
export function isTechnologyStackGraphNode(
  node: Pick<RepoGraphNode, "kind">,
): boolean {
  return node.kind === "reference" || node.kind === "technology_stack";
}
