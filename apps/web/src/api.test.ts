import { describe, expect, test } from 'bun:test';
import {
  extractionFromResponse,
  normaliseEvidenceText,
  privateJsonRequest,
  retryAfterSeconds,
  routeFromResponse,
} from './api';

describe('untrusted browser API parsers', () => {
  test('makes evidence requests explicitly non-cacheable', () => {
    expect(privateJsonRequest({ evidence: [] })).toEqual({
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: '{"evidence":[]}',
    });
  });

  test('normalises newlines while rejecting unsafe control characters', () => {
    expect(normaliseEvidenceText('  first\r\nsecond\rthird  ')).toBe('first\nsecond\nthird');
    expect(normaliseEvidenceText('unsafe\u0000text')).toBeNull();
  });

  test('reads only bounded retry guidance from rate-limited responses', () => {
    expect(
      retryAfterSeconds(new Response('', { status: 429, headers: { 'retry-after': '60' } })),
    ).toBe(60);
    expect(
      retryAfterSeconds(new Response('', { status: 429, headers: { 'retry-after': '9999' } })),
    ).toBeNull();
  });

  test('accepts only contract-shaped extraction responses', () => {
    expect(
      extractionFromResponse(
        {
          source: 'fixture',
          safeMode: false,
          facts: [
            {
              key: 'event_date',
              value: '2026-02-10',
              certainty: 'confirmed',
              evidenceIds: ['evidence-1'],
            },
          ],
        },
        new Set(['evidence-1']),
      ),
    ).toEqual({
      source: 'fixture',
      facts: [
        {
          key: 'event_date',
          value: '2026-02-10',
          certainty: 'confirmed',
          evidenceIds: ['evidence-1'],
        },
      ],
    });
    expect(
      extractionFromResponse(
        {
          source: 'gemini',
          safeMode: false,
          facts: [{ key: 'invented', value: 'x', certainty: 'confirmed', evidenceIds: [] }],
        },
        new Set(['evidence-1']),
      ),
    ).toBeNull();
    expect(
      extractionFromResponse(
        {
          source: 'gemini',
          safeMode: false,
          facts: [
            { key: 'event_date', value: '2026-02-10', certainty: 'confirmed', evidenceIds: ['x'] },
          ],
        },
        new Set(['evidence-1']),
      ),
    ).toBeNull();
  });

  test('rejects route payloads that cannot be safely rendered', () => {
    expect(
      routeFromResponse({
        status: 'safe_preparation_route',
        ruleId: 'scope.termination.preparation',
        actions: [{ id: 'preserve', label: 'Preserve originals' }],
        missingFacts: [],
      })?.status,
    ).toBe('safe_preparation_route');
    expect(
      routeFromResponse({
        status: 'safe_preparation_route',
        ruleId: 'x',
        actions: [{ id: 'bad' }],
        missingFacts: [],
      }),
    ).toBeNull();
  });
});
