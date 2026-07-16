import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVSCOPE_BASE_URL,
  createBasicAuthHeaders,
  normalizeBaseUrl,
  resolveDevScopeConnection,
} from './config';

describe('DevScope 客户端配置', () => {
  it('默认连接本地 API', () => {
    expect(resolveDevScopeConnection({})).toEqual({
      baseUrl: DEFAULT_DEVSCOPE_BASE_URL,
      headers: {},
    });
  });

  it('规范化地址并生成 Basic Auth 请求头', () => {
    expect(
      resolveDevScopeConnection({
        DEVSCOPE_BASE_URL: 'https://devscope.example.com/',
        DEVSCOPE_USERNAME: 'operator',
        DEVSCOPE_PASSWORD: 'secret',
      })
    ).toEqual({
      baseUrl: 'https://devscope.example.com',
      headers: createBasicAuthHeaders('operator', 'secret'),
    });
  });

  it('拒绝不完整的认证信息', () => {
    expect(() => resolveDevScopeConnection({ DEVSCOPE_USERNAME: 'operator' })).toThrow(
      '必须同时设置'
    );
  });

  it('拒绝向公网明文 HTTP 地址发送 Basic Auth', () => {
    expect(() =>
      resolveDevScopeConnection({
        DEVSCOPE_BASE_URL: 'http://203.0.113.10',
        DEVSCOPE_USERNAME: 'operator',
        DEVSCOPE_PASSWORD: 'secret',
      })
    ).toThrow('只允许发送到 HTTPS 或本机回环地址');
  });

  it('允许向本机回环 HTTP 地址发送 Basic Auth', () => {
    expect(
      resolveDevScopeConnection({
        DEVSCOPE_BASE_URL: 'http://127.0.0.1:3100',
        DEVSCOPE_USERNAME: 'operator',
        DEVSCOPE_PASSWORD: 'secret',
      }).headers
    ).toEqual(createBasicAuthHeaders('operator', 'secret'));
  });

  it('拒绝非 HTTP 地址', () => {
    expect(() => normalizeBaseUrl('file:///tmp/devscope')).toThrow('http 或 https');
  });
});
