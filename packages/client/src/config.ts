export const DEFAULT_DEVSCOPE_BASE_URL = 'http://localhost:3100';

export interface DevScopeEnvironment {
  DEVSCOPE_BASE_URL?: string;
  DEVSCOPE_USERNAME?: string;
  DEVSCOPE_PASSWORD?: string;
}

export interface DevScopeConnectionConfig {
  baseUrl: string;
  headers: Record<string, string>;
}

export function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('DEVSCOPE_BASE_URL 不能为空');
  }

  const parsed = new URL(normalized);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('DEVSCOPE_BASE_URL 必须使用 http 或 https');
  }

  return normalized;
}

export function createBasicAuthHeaders(username: string, password: string): Record<string, string> {
  const credentials = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${credentials}` };
}

export function resolveDevScopeConnection(
  env: DevScopeEnvironment = process.env
): DevScopeConnectionConfig {
  const username = env.DEVSCOPE_USERNAME?.trim();
  const password = env.DEVSCOPE_PASSWORD;
  const baseUrl = normalizeBaseUrl(env.DEVSCOPE_BASE_URL ?? DEFAULT_DEVSCOPE_BASE_URL);

  if ((username && !password) || (!username && password)) {
    throw new Error('DEVSCOPE_USERNAME 与 DEVSCOPE_PASSWORD 必须同时设置');
  }

  if (username && password && !isSecureCredentialTarget(baseUrl)) {
    throw new Error('Basic Auth 只允许发送到 HTTPS 或本机回环地址，避免凭据经明文 HTTP 传输');
  }

  return {
    baseUrl,
    headers: username && password ? createBasicAuthHeaders(username, password) : {},
  };
}

function isSecureCredentialTarget(baseUrl: string): boolean {
  const url = new URL(baseUrl);
  return (
    url.protocol === 'https:' ||
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]'
  );
}
