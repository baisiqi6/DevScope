import { describe, expect, it } from "vitest";
import { externalResourceUrlSchema, saveExternalResourceInputSchema } from "@devscope/shared";
import { canonicalizeExternalResourceUrl } from "./external-resources";

describe("external resource URL contract", () => {
  it("只允许没有凭据的 http/https URL", () => {
    expect(externalResourceUrlSchema.safeParse("https://example.com/article").success).toBe(true);
    expect(externalResourceUrlSchema.safeParse("ftp://example.com/file").success).toBe(false);
    expect(externalResourceUrlSchema.safeParse("https://user:pass@example.com").success).toBe(false);
  });

  it("规范化 host、默认端口、fragment 和尾部斜杠", () => {
    expect(canonicalizeExternalResourceUrl("HTTPS://Example.COM:443/design///#preview"))
      .toBe("https://example.com/design");
    expect(canonicalizeExternalResourceUrl("http://Example.COM:80/"))
      .toBe("http://example.com/");
  });

  it("保存输入默认使用 preview_only 所需的最小元数据", () => {
    const parsed = saveExternalResourceInputSchema.parse({
      url: "https://example.com",
      resourceType: "website",
    });
    expect(parsed.tags).toEqual([]);
  });

  it("接受受限的预览元数据并拒绝过大的 JSON", () => {
    expect(saveExternalResourceInputSchema.safeParse({
      url: "https://example.com",
      resourceType: "website",
      metadata: { source: "manual", version: 1 },
    }).success).toBe(true);
    expect(saveExternalResourceInputSchema.safeParse({
      url: "https://example.com",
      resourceType: "website",
      metadata: { body: "x".repeat(20_001) },
    }).success).toBe(false);
  });
});
