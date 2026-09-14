import { describe, expect, test } from 'bun:test';
import { extractionFromResponse, privateJsonRequest, routeFromResponse } from './api';

describe('untrusted browser API parsers', () => {
  test('makes evidence requests explicitly non-cacheable', () => {
    expect(privateJsonRequest({ evidence: [] })).toEqual({
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: '{"evidence":[]}',
    });
  });

  test('accepts only contract-shaped extraction responses', () => {
    expect(
      extractionFromResponse({
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
      }),
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
      extractionFromResponse({
        source: 'gemini',
        safeMode: false,
        facts: [{ key: 'invented', value: 'x', certainty: 'confirmed', evidenceIds: [] }],
      }),
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
