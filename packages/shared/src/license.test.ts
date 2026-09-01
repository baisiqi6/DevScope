import { describe, expect, it } from "vitest";
import { classifyRepositoryLicense } from "./index";

describe("repository license classification", () => {
  it.each([
    ["MIT", undefined, "standard_open_source"],
    ["Apache-2.0", undefined, "standard_open_source"],
    [null, undefined, "no_license"],
    ["NOASSERTION", undefined, "unknown"],
    ["OTHER", undefined, "unknown"],
    [null, "Business Source License 1.1", "source_available"],
    ["OTHER", "This software is not for production use.", "source_available"],
    ["OTHER", "custom terms", "unknown"],
    ["FOO", undefined, "unknown"],
    ["LicenseRef-Proprietary", undefined, "unknown"],
    ["MIT License (custom)", undefined, "unknown"],
    ["BSL-1.1", undefined, "unknown"],
  ] as const)("classifies %p with text %p", (spdx, text, expected) => {
    expect(classifyRepositoryLicense(spdx, text)).toBe(expected);
  });
});
