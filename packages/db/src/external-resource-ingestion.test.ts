import { describe, expect, it, vi } from "vitest";
import {
  ingestExternalResource,
  parseHtmlDocument,
  parsePdfDocument,
} from "./external-resource-ingestion";

function response(body: string | Uint8Array, contentType: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { "content-type": contentType }, ...init });
}

const publicLookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

describe("external resource ingestion", () => {
  it("parses bounded HTML without scripts or page resources", () => {
    expect(parseHtmlDocument("<title> Hello </title><script>alert(1)</script><p>Hello &amp; world</p>")).toEqual({
      title: "Hello",
      text: "Hello & world",
    });
  });

  it("parses minimal PDF text and rejects empty PDF", () => {
    expect(parsePdfDocument(new TextEncoder().encode("%PDF-1.7 (Hello\\nworld) Tj"))).toMatchObject({ text: "Hello world" });
    expect(() => parsePdfDocument(new TextEncoder().encode("%PDF-1.7 no text"))).toThrow();
  });

  it.each([
    ["ftp://example.com/a", "parameter_error"],
    ["http://user:pass@example.com/a", "security_rejected"],
    ["http://127.0.0.1/a", "security_rejected"],
    ["http://[::1]/a", "security_rejected"],
    ["http://[::ffff:192.168.1.1]/a", "security_rejected"],
    ["http://192.0.2.1/a", "security_rejected"],
    ["http://100.64.0.1/a", "security_rejected"],
    ["http://224.0.0.1/a", "security_rejected"],
    ["http://[2001:db8::1]/a", "security_rejected"],
    ["http://[ff02::1]/a", "security_rejected"],
    ["http://192.88.99.1/a", "security_rejected"],
    ["http://[fec0::1]/a", "security_rejected"],
    ["http://[100::1]/a", "security_rejected"],
    ["http://[64:ff9b:1::1]/a", "security_rejected"],
    ["http://[::ffff:8.8.8.8]/a", "security_rejected"],
    ["http://[::192.0.2.1]/a", "security_rejected"],
  ] as const)("rejects unsafe URL %s", async (url, errorKind) => {
    const result = await ingestExternalResource(url, { fetchImpl: vi.fn(), lookup: publicLookup });
    expect(result).toMatchObject({ status: "failure", errorKind });
  });

  it("rejects DNS resolution to private address", async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    const result = await ingestExternalResource("https://example.com", { fetchImpl: vi.fn(), lookup });
    expect(result).toMatchObject({ status: "failure", errorKind: "security_rejected" });
  });

  it("revalidates every redirect and bounds redirect count", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://other.example/path" } }))
      .mockResolvedValueOnce(response("<p>ok</p>", "text/html"));
    const lookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const result = await ingestExternalResource("https://example.com", { fetchImpl, lookup });
    expect(result).toMatchObject({ status: "success", finalUrl: "https://other.example/path" });
    expect(lookup).toHaveBeenCalledTimes(4);

    const tooMany = vi.fn().mockImplementation(async () => new Response(null, { status: 302, headers: { location: "https://example.com/next" } }));
    const bounded = await ingestExternalResource("https://example.com", { fetchImpl: tooMany, lookup: publicLookup, maxRedirects: 1 });
    expect(bounded).toMatchObject({ status: "failure", errorKind: "security_rejected" });
    expect(tooMany).toHaveBeenCalledTimes(2);
  });

  it("在实际连接前检测 DNS rebinding，不向第二次私网解析发起请求", async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    const fetchImpl = vi.fn();
    const result = await ingestExternalResource("https://example.com", { lookup, fetchImpl });
    expect(result).toMatchObject({ status: "failure", errorKind: "security_rejected" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("第二次 DNS lookup 抛错时返回 transient_failure 而非裸 reject", async () => {
    const lookup = vi.fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockRejectedValueOnce(new Error("resolver timeout"));
    const result = await ingestExternalResource("https://example.com", { lookup, fetchImpl: vi.fn() });
    expect(result).toMatchObject({ status: "failure", errorKind: "transient_failure" });
  });

  it("malformed redirect Location 返回 parameter_error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "%%%" } }));
    const result = await ingestExternalResource("https://example.com", { lookup: publicLookup, fetchImpl });
    expect(result).toMatchObject({ status: "failure", errorKind: "parameter_error" });
  });

  it("enforces content type, body size, compression and timeout", async () => {
    const unsupported = await ingestExternalResource("https://example.com", {
      fetchImpl: vi.fn().mockResolvedValue(response("ok", "application/json")), lookup: publicLookup,
    });
    expect(unsupported).toMatchObject({ status: "failure", errorKind: "unsupported_type" });

    const oversized = await ingestExternalResource("https://example.com", {
      fetchImpl: vi.fn().mockResolvedValue(response("12345", "text/html")), lookup: publicLookup, maxBytes: 2,
    });
    expect(oversized).toMatchObject({ status: "failure", errorKind: "parameter_error" });

    const compressed = await ingestExternalResource("https://example.com", {
      fetchImpl: vi.fn().mockResolvedValue(response("ok", "text/html", { headers: { "content-encoding": "gzip" } })), lookup: publicLookup,
    });
    expect(compressed).toMatchObject({ status: "failure", errorKind: "unsupported_type" });

    const timeoutFetch = vi.fn((_url: URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")));
    }));
    const timedOut = await ingestExternalResource("https://example.com", { fetchImpl: timeoutFetch, lookup: publicLookup, timeoutMs: 5 });
    expect(timedOut).toMatchObject({ status: "failure", errorKind: "transient_failure" });
  });

  it("returns parse_failure for empty HTML and successful bounded PDF", async () => {
    const empty = await ingestExternalResource("https://example.com", {
      fetchImpl: vi.fn().mockResolvedValue(response("   ", "text/html")), lookup: publicLookup,
    });
    expect(empty).toMatchObject({ status: "failure", errorKind: "parse_failure" });
    const pdf = await ingestExternalResource("https://example.com/file.pdf", {
      fetchImpl: vi.fn().mockResolvedValue(response("%PDF-1.7 (paper) Tj", "application/pdf")), lookup: publicLookup,
    });
    expect(pdf).toMatchObject({ status: "success", contentType: "pdf", text: "paper" });
  });
});
