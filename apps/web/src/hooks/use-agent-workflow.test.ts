import { describe, expect, it } from "vitest";
import { getStreamEndError } from "./use-agent-workflow";

describe("getStreamEndError", () => {
  it("运行中连接结束时返回错误，避免假完成", () => {
    expect(getStreamEndError("running")).toBe("工作流连接意外结束，请查询服务器状态后重试");
  });

  it.each(["completed", "failed", "cancelled"] as const)("终态 %s 不生成额外错误", (status) => {
    expect(getStreamEndError(status)).toBeNull();
  });
});
