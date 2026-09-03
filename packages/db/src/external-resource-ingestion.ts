import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import * as ipaddr from "ipaddr.js";

export type IngestionErrorKind =
  | "parameter_error"
  | "security_rejected"
  | "transient_failure"
  | "unsupported_type"
  | "parse_failure"
  | "unknown";

export interface ExternalResourceIngestionOptions {
  fetchImpl?: (url: URL, init: RequestInit, verifiedAddress?: string) => Promise<Response>;
  lookup?: typeof dns.lookup;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  maxTextChars?: number;
}

export interface ExternalResourceIngestionSuccess {
  status: "success";
  contentType: "html" | "pdf";
  finalUrl: string;
  title: string | null;
  text: string;
  bytes: number;
}

export interface ExternalResourceIngestionFailure {
  status: "failure";
  errorKind: IngestionErrorKind;
  error: string;
}

export type ExternalResourceIngestionResult =
  | ExternalResourceIngestionSuccess
  | ExternalResourceIngestionFailure;

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 1_000_000,
  maxRedirects: 3,
  maxTextChars: 100_000,
};

function failure(errorKind: IngestionErrorKind, error: string): ExternalResourceIngestionFailure {
  return { status: "failure", errorKind, error };
}

function isForbiddenAddress(address: string): boolean {
  if (!net.isIP(address)) return true;
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv4") return parsed.range() !== "unicast";
    // ipaddr.js marks a few deprecated site-local/translation prefixes as
    // unicast; explicitly classify those as non-forwardable as well.
    if (parsed.range() !== "unicast") return true;
    const ipv6 = parsed as ipaddr.IPv6;
    // Deprecated IPv4-compatible forms (::a.b.c.d / ::xxxx:xxxx) are
    // conversion addresses, not independently forwardable IPv6 endpoints.
    if (ipv6.parts.slice(0, 6).every((part) => part === 0)) return true;
    const blocked = [
      [ipaddr.parse("fec0::"), 10], // deprecated site-local
      [ipaddr.parse("64:ff9b:1::"), 48], // constrained NAT64 well-known prefix
    ] as const;
    return blocked.some(([network, prefix]) => parsed.match(network, prefix));
  } catch {
    return true;
  }
}

function validateUrl(raw: string): URL | ExternalResourceIngestionFailure {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return failure("parameter_error", "URL 无法解析");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return failure("parameter_error", "仅支持 http/https URL");
  }
  if (url.username || url.password) {
    return failure("security_rejected", "URL 不得包含用户名或密码");
  }
  if (!url.hostname) return failure("parameter_error", "URL 缺少主机名");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname) && isForbiddenAddress(hostname)) {
    return failure("security_rejected", "目标地址属于 loopback/private/link-local 网段");
  }
  return url;
}

async function validateResolvedHost(
  url: URL,
  lookup: typeof dns.lookup,
): Promise<ExternalResourceIngestionFailure | null> {
  try {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const records = net.isIP(hostname)
      ? [{ address: hostname, family: net.isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0 || records.some((record) => isForbiddenAddress(record.address))) {
      return failure("security_rejected", "DNS 解析结果包含受限地址");
    }
    return null;
  } catch {
    return failure("transient_failure", "DNS 解析失败");
  }
}

async function readBoundedBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new RangeError("响应体超过大小上限");
      chunks.push(next.value);
      if (signal.aborted) throw new DOMException("请求超时", "TimeoutError");
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function pinnedFetch(url: URL, init: RequestInit, verifiedAddress: string): Promise<Response> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: init.method ?? "GET",
      headers: { ...(init.headers as Record<string, string> | undefined), host: url.host },
      hostname: url.hostname.replace(/^\[|\]$/g, ""),
      lookup: (_hostname, _options, callback) => callback(null, verifiedAddress, net.isIP(verifiedAddress)),
      servername: url.hostname.replace(/^\[|\]$/g, ""),
      path: `${url.pathname}${url.search}`,
      signal: init.signal ?? undefined,
    }, (message) => {
      const chunks: Buffer[] = [];
      message.on("data", (chunk: Buffer) => chunks.push(chunk));
      message.on("end", () => resolve(new Response(Buffer.concat(chunks), {
        status: message.statusCode ?? 0,
        headers: message.headers as Record<string, string>,
      })));
    });
    request.once("error", reject);
    request.end();
  });
}

function contentTypeOf(response: Response, url: URL): "html" | "pdf" | null {
  const value = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (value === "text/html" || value === "application/xhtml+xml") return "html";
  if (value === "application/pdf") return "pdf";
  if (!value && url.pathname.toLowerCase().endsWith(".pdf")) return "pdf";
  return null;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, (entity) => ({
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " ",
  }[entity.toLowerCase()] ?? entity));
}

export function parseHtmlDocument(input: string, maxTextChars = DEFAULTS.maxTextChars): Pick<ExternalResourceIngestionSuccess, "title" | "text"> {
  const title = decodeHtmlEntities(input.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    .replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const withoutUnsafe = input
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeHtmlEntities(withoutUnsafe).replace(/\s+/g, " ").trim().slice(0, maxTextChars);
  return { title, text };
}

function decodePdfLiteral(value: string): string {
  return value.replace(/\\([\\()nrt])/g, (_, escaped: string) => ({ "n": "\n", "r": "\r", "t": "\t" }[escaped] ?? escaped));
}

export function parsePdfDocument(bytes: Uint8Array, maxTextChars = DEFAULTS.maxTextChars): Pick<ExternalResourceIngestionSuccess, "title" | "text"> {
  const source = new TextDecoder("latin1").decode(bytes);
  if (!source.startsWith("%PDF-")) throw new Error("不是有效 PDF");
  const literals = [...source.matchAll(/\(([^()]*)\)\s*T[Jj]/g)].map((match) => decodePdfLiteral(match[1]));
  const text = literals.join(" ").replace(/\s+/g, " ").trim().slice(0, maxTextChars);
  if (!text) throw new Error("PDF 未提取到正文");
  return { title: null, text };
}

export async function ingestExternalResource(rawUrl: string, options: ExternalResourceIngestionOptions = {}): Promise<ExternalResourceIngestionResult> {
  const config = { ...DEFAULTS, ...options };
  const fetchImpl = config.fetchImpl;
  const lookup = config.lookup ?? dns.lookup;
  let current = validateUrl(rawUrl);
  if (!(current instanceof URL)) return current;

  for (let redirect = 0; redirect <= config.maxRedirects; redirect += 1) {
    const blocked = await validateResolvedHost(current, lookup);
    if (blocked) return blocked;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response: Response;
    let verifiedAddress: string | undefined;
    try {
      verifiedAddress = net.isIP(current.hostname.replace(/^\[|\]$/g, ""))
        ? current.hostname.replace(/^\[|\]$/g, "")
        : (await lookup(current.hostname.replace(/^\[|\]$/g, ""), { all: true, verbatim: true }))[0]?.address;
    } catch (error) {
      clearTimeout(timer);
      return failure("transient_failure", error instanceof Error ? error.message : String(error));
    }
    if (!verifiedAddress || isForbiddenAddress(verifiedAddress)) {
      clearTimeout(timer);
      return failure("security_rejected", "DNS 解析结果包含受限地址");
    }
    try {
      response = await (fetchImpl
        ? fetchImpl(current, { redirect: "manual", signal: controller.signal }, verifiedAddress)
        : pinnedFetch(current, { redirect: "manual", signal: controller.signal }, verifiedAddress));
    } catch (error) {
      clearTimeout(timer);
      return failure(controller.signal.aborted ? "transient_failure" : "transient_failure", error instanceof Error ? error.message : String(error));
    }
    if (response.status >= 300 && response.status < 400) {
      if (redirect === config.maxRedirects) {
        clearTimeout(timer);
        return failure("security_rejected", "重定向次数超过上限");
      }
      const location = response.headers.get("location");
      if (!location) {
        clearTimeout(timer);
        return failure("parse_failure", "重定向缺少 Location");
      }
      if (/%(?![0-9A-Fa-f]{2})/.test(location)) {
        clearTimeout(timer);
        return failure("parameter_error", "重定向 Location 含非法转义");
      }
      let next: URL | ExternalResourceIngestionFailure;
      try {
        next = validateUrl(new URL(location, current).toString());
      } catch {
        clearTimeout(timer);
        return failure("parameter_error", "重定向 Location 无法解析");
      }
      if (!(next instanceof URL)) {
        clearTimeout(timer);
        return next;
      }
      clearTimeout(timer);
      current = next;
      continue;
    }
    if (!response.ok) {
      clearTimeout(timer);
      return failure(response.status === 408 || response.status === 429 || response.status >= 500 ? "transient_failure" : "unknown", `上游响应 ${response.status}`);
    }
    if (response.headers.get("content-encoding") && response.headers.get("content-encoding") !== "identity") {
      clearTimeout(timer);
      return failure("unsupported_type", "压缩响应暂不支持");
    }
    const kind = contentTypeOf(response, current);
    if (!kind) {
      clearTimeout(timer);
      return failure("unsupported_type", "仅支持 text/html、application/xhtml+xml 和 application/pdf");
    }
    try {
      const body = await readBoundedBody(response, config.maxBytes, controller.signal);
      if (body.byteLength === 0) {
        clearTimeout(timer);
        return failure("parse_failure", "响应体为空");
      }
      const parsed = kind === "html"
        ? parseHtmlDocument(new TextDecoder().decode(body), config.maxTextChars)
        : parsePdfDocument(body, config.maxTextChars);
      if (!parsed.text.trim()) {
        clearTimeout(timer);
        return failure("parse_failure", "正文为空");
      }
      clearTimeout(timer);
      return { status: "success", contentType: kind, finalUrl: current.toString(), ...parsed, bytes: body.byteLength };
    } catch (error) {
      clearTimeout(timer);
      return failure(error instanceof RangeError ? "parameter_error" : "parse_failure", error instanceof Error ? error.message : String(error));
    }
  }
  return failure("security_rejected", "重定向次数超过上限");
}
