import { describe, expect, it } from "vitest";
import ResourcesPage, { metadata } from "./page";
import { ExternalResourceWorkspace } from "@/components/external-resource-workspace";

describe("resources page", () => {
  it("exposes the external resources route metadata and workspace", () => {
    expect(metadata.title).toContain("外部资源");
    expect(ResourcesPage().type).toBe(ExternalResourceWorkspace);
  });
});
