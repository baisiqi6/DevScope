import { describe, expect, it } from "vitest";
import {
  repoGraphNodeSchema,
} from "@devscope/shared";
import { isTechnologyStackGraphNode } from "./repo-graph-node";

const base = {
  id: "stack:react",
  fullName: "tech-stack/react",
  name: "React",
  language: null,
  stars: null,
  description: "React 技术栈",
};

describe("graph contract (Phase C cleanup revision)", () => {
  it("technology_stack contract 被识别为技术栈节点", () => {
    const node = repoGraphNodeSchema.parse({
      ...base,
      kind: "technology_stack",
    });
    expect(isTechnologyStackGraphNode(node)).toBe(true);
    expect(isTechnologyStackGraphNode({ ...node, kind: "repo" })).toBe(false);
    expect(isTechnologyStackGraphNode({ ...node, kind: "language" })).toBe(false);
  });

  it("legacy reference kind 与 isReference 字段已随契约删除（fail closed）", () => {
    expect(() => repoGraphNodeSchema.parse({
      ...base,
      id: "41",
      kind: "reference",
      isReference: true,
    })).toThrow();
  });

  it("未知 kind 仍 fail closed", () => {
    expect(() => repoGraphNodeSchema.parse({ ...base, kind: "stack" })).toThrow();
  });
});
