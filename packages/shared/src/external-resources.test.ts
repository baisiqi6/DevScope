import { describe, expect, it } from "vitest";
import { externalResourceMetadataSchema } from "./index";

describe("external resource metadata contract", () => {
  it("uses UTF-8 byte length for the 20KB boundary", () => {
    expect(() => externalResourceMetadataSchema.parse({ payload: "中".repeat(7_000) })).toThrow();
    expect(externalResourceMetadataSchema.parse({ payload: "x".repeat(19_900) })).toBeTruthy();
  });
});
