import { describe, expect, test } from 'bun:test';

import { app } from './app';
import { ConfigurationError, loadRuntimeConfig } from './config';

describe('API baseline', () => {
  test('returns a non-cacheable health response with security headers', async () => {
    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('uses a safe error envelope for an unknown endpoint', async () => {
    const response = await app.request('/not-a-route');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });
});

describe('runtime configuration', () => {
  test('defaults to rule-only mode without a credential', () => {
    expect(loadRuntimeConfig({})).toEqual({ AI_PROVIDER: 'disabled', PORT: 3001 });
  });

  test('fails closed when Gemini mode has no credential', () => {
    expect(() => loadRuntimeConfig({ AI_PROVIDER: 'gemini' })).toThrow(ConfigurationError);
  });

  test('accepts Gemini mode only with a non-empty credential', () => {
    expect(loadRuntimeConfig({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key' })).toEqual({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
      PORT: 3001,
    });
  });
});
