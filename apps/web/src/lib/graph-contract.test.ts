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

describe("graph contract rollout compatibility", () => {
  it("同时接受旧 reference/isReference 与新 technology_stack contract", () => {
    const legacy = repoGraphNodeSchema.parse({
      ...base,
      id: "41",
      kind: "reference",
      isReference: true,
    });
    const current = repoGraphNodeSchema.parse({
      ...base,
      kind: "technology_stack",
    });

    expect(isTechnologyStackGraphNode(legacy)).toBe(true);
    expect(isTechnologyStackGraphNode(current)).toBe(true);
    expect(current.isReference).toBeUndefined();
  });

  it("未知 kind 仍 fail closed", () => {
    expect(() => repoGraphNodeSchema.parse({ ...base, kind: "stack" })).toThrow();
  });
});
