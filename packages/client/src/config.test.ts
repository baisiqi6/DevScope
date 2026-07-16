import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVSCOPE_BASE_URL,
  createBasicAuthHeaders,
  normalizeBaseUrl,
  resolveDevScopeConnection,
} from "./config";

describe("DevScope 客户端配置", () => {
  it("默认连接本地 API", () => {
    expect(resolveDevScopeConnection({})).toEqual({
      baseUrl: DEFAULT_DEVSCOPE_BASE_URL,
      headers: {},
    });
  });

  it("规范化地址并生成 Basic Auth 请求头", () => {
    expect(
      resolveDevScopeConnection({
        DEVSCOPE_BASE_URL: "https://devscope.example.com/",
        DEVSCOPE_USERNAME: "operator",
        DEVSCOPE_PASSWORD: "secret",
      }),
    ).toEqual({
      baseUrl: "https://devscope.example.com",
      headers: createBasicAuthHeaders("operator", "secret"),
    });
  });

  it("拒绝不完整的认证信息", () => {
    expect(() =>
      resolveDevScopeConnection({ DEVSCOPE_USERNAME: "operator" }),
    ).toThrow("必须同时设置");
  });

  it("拒绝非 HTTP 地址", () => {
    expect(() => normalizeBaseUrl("file:///tmp/devscope")).toThrow("http 或 https");
  });
});
