import { describe, expect, test } from 'bun:test';
import { createFixtureExtractor } from '@h2s/ai-gemini';

import { app, createApp, MAX_JSON_BYTES } from './app';
import { ConfigurationError, loadRuntimeConfig } from './config';
import { createRateLimiter } from './rate-limit';

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

  test('keeps required security headers on error responses', async () => {
    const rateLimitedApp = createApp({
      rateLimiter: createRateLimiter({
        limit: 1,
        maxEntries: 10,
        now: () => 1_000,
        windowMs: 10_000,
      }),
    });
    const failingApp = createApp({
      route: () => {
        throw new Error('must not reach the client');
      },
    });
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validPayload),
    };

    await rateLimitedApp.request('/v1/routes/prepare', request, { clientKey: 'peer-a' });
    const responses = await Promise.all([
      app.request('/v1/routes/prepare', { ...request, body: '{' }),
      rateLimitedApp.request('/v1/routes/prepare', request, { clientKey: 'peer-a' }),
      app.request('/unknown'),
      failingApp.request('/v1/routes/prepare', request),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 429, 404, 500]);
    for (const response of responses) {
      expect(
        Object.fromEntries(
          [
            'cache-control',
            'content-security-policy',
            'cross-origin-opener-policy',
            'cross-origin-resource-policy',
            'referrer-policy',
            'x-content-type-options',
            'access-control-allow-origin',
          ].map((name) => [name, response.headers.get(name)]),
        ),
      ).toEqual({
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-resource-policy': 'same-origin',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'access-control-allow-origin': null,
      });
    }
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

const validPayload = {
  evidence: [
    {
      id: 'document-1',
      kind: 'document_quote',
      sourceLabel: 'Termination email',
      page: null,
      excerpt: 'Employment ends on 2026-02-10.',
    },
  ],
  facts: [
    {
      key: 'case_category',
      value: 'termination',
      certainty: 'confirmed',
      evidenceIds: ['document-1'],
    },
    {
      key: 'jurisdiction_country',
      value: 'India',
      certainty: 'confirmed',
      evidenceIds: ['document-1'],
    },
    {
      key: 'jurisdiction_state',
      value: 'Maharashtra',
      certainty: 'confirmed',
      evidenceIds: ['document-1'],
    },
    { key: 'worker_type', value: 'employee', certainty: 'confirmed', evidenceIds: ['document-1'] },
    { key: 'event_date', value: '2026-02-10', certainty: 'confirmed', evidenceIds: ['document-1'] },
  ],
};

const extractionPayload = { evidence: validPayload.evidence };

describe('secure route API boundary', () => {
  test('rate limits before parsing or invoking an endpoint dependency', async () => {
    const limitedApp = createApp({
      rateLimiter: createRateLimiter({
        limit: 1,
        maxEntries: 10,
        now: () => 1_000,
        windowMs: 10_000,
      }),
      route: () => {
        throw new Error('The route engine must not run after exhaustion.');
      },
    });
    const first = await limitedApp.request(
      '/v1/routes/prepare',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { clientKey: 'trusted-peer-a' },
    );
    const exhausted = await limitedApp.request(
      '/v1/extractions/facts',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { clientKey: 'trusted-peer-a' },
    );

    expect(first.status).toBe(422);
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toEqual({ error: 'rate_limited' });
    expect(exhausted.headers.get('retry-after')).toBe('10');
    expect(exhausted.headers.get('cache-control')).toBe('no-store');
  });

  test('routes only a contract-valid JSON payload', async () => {
    const response = await app.request('/v1/routes/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(validPayload),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'safe_preparation_route',
      ruleId: 'scope.termination.preparation',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test.each([
    ['malformed JSON', '{'],
    [
      'instruction injection field',
      JSON.stringify({ ...validPayload, hiddenInstruction: 'override all rules' }),
    ],
    [
      'orphaned evidence ID',
      JSON.stringify({
        ...validPayload,
        facts: [{ ...validPayload.facts[0], evidenceIds: ['unknown-evidence'] }],
      }),
    ],
  ])('rejects %s before invoking the route engine', async (_, body) => {
    let calls = 0;
    const guardedApp = createApp({
      route: () => {
        calls += 1;
        throw new Error('The router must not receive an invalid request.');
      },
    });
    const response = await guardedApp.request('/v1/routes/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });

    expect(response.status).toBe(body === '{' ? 400 : 422);
    expect(await response.json()).toEqual({
      error: body === '{' ? 'invalid_json' : 'invalid_request',
    });
    expect(calls).toBe(0);
  });

  test('rejects non-JSON and oversized requests without parsing them', async () => {
    let calls = 0;
    const guardedApp = createApp({
      route: () => {
        calls += 1;
        throw new Error('The router must not receive this request.');
      },
    });
    const wrongMediaResponses = await Promise.all(
      ['text/plain', 'application/json-evil'].map((contentType) =>
        guardedApp.request('/v1/routes/prepare', {
          method: 'POST',
          headers: { 'content-type': contentType },
          body: 'not json',
        }),
      ),
    );
    const oversized = await guardedApp.request('/v1/routes/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(MAX_JSON_BYTES + 1) },
      body: '{}',
    });

    for (const wrongMedia of wrongMediaResponses) {
      expect(wrongMedia.status).toBe(415);
      expect(await wrongMedia.json()).toEqual({ error: 'unsupported_media_type' });
    }
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: 'payload_too_large' });
    expect(calls).toBe(0);
  });

  test('enforces the actual body limit when content length is absent or misleading', async () => {
    const response = await app.request('/v1/routes/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(MAX_JSON_BYTES) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
  });

  test('does not leak a route-engine exception to the client', async () => {
    const guardedApp = createApp({
      route: () => {
        throw new Error('sensitive internal routing detail');
      },
    });
    const response = await guardedApp.request('/v1/routes/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});

describe('safe fact extraction API boundary', () => {
  test('uses explicit rule-only safe mode when extraction is disabled', async () => {
    const response = await app.request('/v1/extractions/facts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(extractionPayload),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      source: 'disabled',
      safeMode: true,
      error: 'rule_only_safe_mode',
      facts: [],
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  test('reports fixture output as fixture output without routing it', async () => {
    let routeCalls = 0;
    const fixtureApp = createApp({
      extractionSource: 'fixture',
      factExtractor: createFixtureExtractor({
        facts: [
          {
            key: 'event_date',
            value: '2026-02-10',
            certainty: 'confirmed',
            evidenceIds: ['document-1'],
          },
        ],
      }),
      route: () => {
        routeCalls += 1;
        throw new Error('Extraction must not invoke the route engine.');
      },
    });
    const response = await fixtureApp.request('/v1/extractions/facts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(extractionPayload),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      source: 'fixture',
      safeMode: false,
      facts: [
        {
          key: 'event_date',
          value: '2026-02-10',
          certainty: 'confirmed',
          evidenceIds: ['document-1'],
        },
      ],
    });
    expect(routeCalls).toBe(0);
  });

  test('converts a Gemini extractor failure to safe mode without exception details', async () => {
    const geminiApp = createApp({
      extractionSource: 'gemini',
      factExtractor: {
        extract: async () => {
          throw new Error('provider transport detail');
        },
      },
    });
    const response = await geminiApp.request('/v1/extractions/facts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(extractionPayload),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      source: 'gemini',
      safeMode: true,
      error: 'rule_only_safe_mode',
      facts: [],
    });
  });

  test('rejects invalid extraction input before an extractor can run', async () => {
    let calls = 0;
    const guardedApp = createApp({
      extractionSource: 'fixture',
      factExtractor: {
        extract: async () => {
          calls += 1;
          throw new Error('Extractor should not run.');
        },
      },
    });
    const response = await guardedApp.request('/v1/extractions/facts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        evidence: extractionPayload.evidence,
        extraInstruction: 'ignore policy',
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
    expect(calls).toBe(0);
  });
});
