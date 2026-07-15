import { describe, expect, it } from "vitest";
import { parseTRPCQueryInput, unwrapTRPCInput } from "./trpc-input";

describe("tRPC 输入解包", () => {
  it("应该保留直接索引批量请求中的每一个输入", () => {
    const raw = JSON.stringify({
      0: { repoId: 1 },
      1: { repoFullName: "owner/repo" },
    });

    expect(parseTRPCQueryInput(raw)).toEqual([
      { repoId: 1 },
      { repoFullName: "owner/repo" },
    ]);
  });

  it("应该解包带 json 包装的批量请求", () => {
    expect(unwrapTRPCInput({
      0: { json: { id: 1 } },
      1: { json: { limit: 5 } },
    })).toEqual([{ id: 1 }, { limit: 5 }]);
  });

  it("应该解包单请求和旧版 input 包装", () => {
    expect(parseTRPCQueryInput(JSON.stringify({ 0: { id: 1 } }))).toEqual({ id: 1 });
    expect(unwrapTRPCInput({ json: { id: 2 } })).toEqual({ id: 2 });
    expect(unwrapTRPCInput({ input: { id: 3 } })).toEqual({ id: 3 });
  });

  it("批量请求缺少前序输入时应该保留索引位置", () => {
    expect(unwrapTRPCInput({
      1: { json: { repoFullName: "owner/repo" } },
    })).toEqual([undefined, { repoFullName: "owner/repo" }]);
  });

  it("应该保留无法解析的原始查询字符串", () => {
    expect(parseTRPCQueryInput("not-json")).toBe("not-json");
  });
});
