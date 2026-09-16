import { describe, expect, test } from 'bun:test';
import {
  documentBriefFromResponse,
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
    expect(
      extractionFromResponse(
        {
          source: 'gemini',
          safeMode: false,
          facts: [
            {
              key: 'event_date',
              value: '2026-02-10',
              certainty: 'confirmed',
              evidenceIds: ['evidence-1', 'evidence-1'],
            },
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
    expect(
      routeFromResponse({
        status: 'safe_preparation_route',
        ruleId: 'x'.repeat(129),
        actions: [{ id: 'preserve', label: 'Preserve originals' }],
        missingFacts: [],
      }),
    ).toBeNull();
    expect(
      routeFromResponse({
        status: 'safe_preparation_route',
        ruleId: 'scope.termination.preparation',
        actions: [
          { id: 'preserve', label: 'Preserve originals' },
          { id: 'preserve', label: 'Preserve duplicates' },
        ],
        missingFacts: [],
      }),
    ).toBeNull();
  });

  test('accepts only a brief that preserves submitted source targets exactly', () => {
    const document = {
      sourceLabel: 'Termination email',
      text: 'Employment ended today.',
      segments: [
        {
          id: 'segment-1',
          page: null,
          sourceStart: 0,
          sourceEnd: 22,
          text: 'Employment ended today.',
        },
      ],
    } as const;
    const response = {
      document,
      items: [
        {
          citation: { segmentIds: ['segment-1'] },
          kind: 'summary',
          severity: null,
          text: 'Review this source excerpt.',
        },
      ],
    };

    expect(documentBriefFromResponse(response, document)?.items).toHaveLength(1);
    expect(
      documentBriefFromResponse(
        { ...response, document: { ...document, text: 'A substituted source.' } },
        document,
      ),
    ).toBeNull();
    expect(
      documentBriefFromResponse(
        {
          ...response,
          items: [{ ...response.items[0], citation: { segmentIds: ['segment-2'] } }],
        },
        document,
      ),
    ).toBeNull();
  });
});
