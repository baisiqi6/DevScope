import { describe, expect, it } from "vitest";
import {
  assertTechnologyStackStorageModeSupported,
  compareTechnologyStackProjectionRows,
  parseLegacyTechnologyStackEvidence,
  parseTechnologyStackStorageMode,
  sameTechnologyStackPackages,
} from "./technology-stack-entities";

describe("legacy technology stack evidence", () => {
  it("严格接受并规范排序 canonical package triples", () => {
    expect(parseLegacyTechnologyStackEvidence({
      kind: "dependency",
      resolvedBy: "tech-stack-catalog",
      packages: [
        { system: "npm", name: "react-dom", version: "19.0.0" },
        { system: "npm", name: "react", version: "19.0.0" },
        { system: "npm", name: "react", version: "19.0.0" },
      ],
    })).toEqual({
      rawCount: 3,
      packages: [
        { system: "npm", name: "react", version: "19.0.0" },
        { system: "npm", name: "react-dom", version: "19.0.0" },
      ],
    });
  });

  it("拒绝缺字段 package、错误 kind 与错误 resolver，不能过滤后伪装成功", () => {
    expect(() => parseLegacyTechnologyStackEvidence({
      kind: "dependency",
      resolvedBy: "tech-stack-catalog",
      packages: [{ system: "npm", name: "react" }],
    })).toThrow();
    expect(() => parseLegacyTechnologyStackEvidence({
      kind: "similarity",
      resolvedBy: "tech-stack-catalog",
      packages: [],
    })).toThrow();
    expect(() => parseLegacyTechnologyStackEvidence({
      kind: "dependency",
      resolvedBy: "deps.dev",
      packages: [],
    })).toThrow();
  });

  it("跨用户副本只按 canonical triples 比较，不受顺序和重复影响", () => {
    const left = parseLegacyTechnologyStackEvidence({
      kind: "dependency",
      resolvedBy: "tech-stack-catalog",
      packages: [
        { system: "npm", name: "react", version: "19.0.0" },
        { system: "npm", name: "react-dom", version: "19.0.0" },
      ],
    }).packages;
    const reordered = parseLegacyTechnologyStackEvidence({
      kind: "dependency",
      resolvedBy: "tech-stack-catalog",
      packages: [
        { system: "npm", name: "react-dom", version: "19.0.0" },
        { system: "npm", name: "react", version: "19.0.0" },
        { system: "npm", name: "react", version: "19.0.0" },
      ],
    }).packages;
    const divergent = parseLegacyTechnologyStackEvidence({
      kind: "dependency",
      resolvedBy: "tech-stack-catalog",
      packages: [{ system: "npm", name: "react", version: "18.3.1" }],
    }).packages;

    expect(sameTechnologyStackPackages(left, reordered)).toBe(true);
    expect(sameTechnologyStackPackages(left, divergent)).toBe(false);
  });
});

describe("technology stack rollout contract", () => {
  it("未知 mode 与尚未实现的 cutover mode 均 fail closed", () => {
    expect(() => parseTechnologyStackStorageMode("typo")).toThrow();
    expect(() => assertTechnologyStackStorageModeSupported(
      parseTechnologyStackStorageMode("new_read_dual_write"),
      ["legacy_shadow_dual_write"],
    )).toThrow("当前 revision 不支持");
    expect(parseTechnologyStackStorageMode(undefined)).toBe("legacy_shadow_dual_write");
  });

  it("shadow comparison 忽略 package 顺序，但报告真实差异", () => {
    const legacy = [{
      githubRepositoryId: "100",
      slug: "react",
      stackName: "React",
      packages: [
        { system: "npm", name: "react-dom", version: "19.0.0" },
        { system: "npm", name: "react", version: "19.0.0" },
      ],
    }];
    const reordered = [{
      ...legacy[0],
      packages: [...legacy[0].packages].reverse(),
    }];
    expect(compareTechnologyStackProjectionRows(legacy, reordered)).toMatchObject({
      equal: true,
      legacyCount: 1,
      newCount: 1,
    });

    const divergent = [{
      ...legacy[0],
      packages: [{ system: "npm", name: "react", version: "18.3.1" }],
    }];
    expect(compareTechnologyStackProjectionRows(legacy, divergent)).toMatchObject({
      equal: false,
      legacyCount: 1,
      newCount: 1,
    });
  });
});
