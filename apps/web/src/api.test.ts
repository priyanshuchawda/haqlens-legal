import { describe, expect, test } from 'bun:test';
import {
  dateCalculationFromResponse,
  documentBriefFromResponse,
  documentComparisonFromResponse,
  extractionFromResponse,
  groundedAnswerFromResponse,
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

  test('accepts only a comparison that preserves both source documents and sides', () => {
    const left = {
      sourceLabel: 'Earlier',
      text: 'Old clause.',
      segments: [
        { id: 'segment-1', page: null, sourceStart: 0, sourceEnd: 11, text: 'Old clause.' },
      ],
    } as const;
    const right = {
      sourceLabel: 'Revised',
      text: 'New clause.',
      segments: [
        { id: 'segment-1', page: null, sourceStart: 0, sourceEnd: 11, text: 'New clause.' },
      ],
    } as const;
    const response = {
      left,
      right,
      changes: [{ kind: 'changed', leftSegmentIds: ['segment-1'], rightSegmentIds: ['segment-1'] }],
    };

    expect(documentComparisonFromResponse(response, left, right)?.changes).toHaveLength(1);
    expect(
      documentComparisonFromResponse(
        { ...response, left: { ...left, text: 'Substituted.' } },
        left,
        right,
      ),
    ).toBeNull();
    expect(
      documentComparisonFromResponse(
        {
          ...response,
          changes: [{ kind: 'added', leftSegmentIds: ['segment-1'], rightSegmentIds: null }],
        },
        left,
        right,
      ),
    ).toBeNull();
  });

  test('accepts only a confirmed or withheld date for its exact submitted anchor', () => {
    const input = {
      anchor: { confirmed: true, date: '2026-02-10', citation: { segmentIds: ['segment-1'] } },
      offsetDays: 30,
    } as const;
    expect(
      dateCalculationFromResponse({ ...input, date: '2026-03-12', status: 'confirmed' }, input)
        ?.date,
    ).toBe('2026-03-12');
    expect(
      dateCalculationFromResponse(
        {
          ...input,
          anchor: { ...input.anchor, date: '2026-02-11' },
          date: '2026-03-13',
          status: 'confirmed',
        },
        input,
      ),
    ).toBeNull();
    expect(
      dateCalculationFromResponse(
        {
          ...input,
          anchor: { ...input.anchor, confirmed: false },
          date: null,
          status: 'needs_human_review',
        },
        { ...input, anchor: { ...input.anchor, confirmed: false } },
      )?.date,
    ).toBeNull();
  });

  test('accepts only cited answers for submitted document segments', () => {
    const document = {
      sourceLabel: 'Notice',
      text: 'Payment is due.',
      segments: [
        { id: 'segment-1', page: null, sourceStart: 0, sourceEnd: 15, text: 'Payment is due.' },
      ],
    } as const;
    expect(
      groundedAnswerFromResponse(
        {
          answer: 'The document states: “Payment is due.”',
          citation: { segmentIds: ['segment-1'] },
          status: 'answered',
        },
        document,
      )?.status,
    ).toBe('answered');
    expect(
      groundedAnswerFromResponse(
        { answer: 'Uncited answer', citation: { segmentIds: ['segment-2'] }, status: 'answered' },
        document,
      ),
    ).toBeNull();
    expect(
      groundedAnswerFromResponse(
        { answer: 'Invented answer', citation: null, status: 'needs_human_review' },
        document,
      ),
    ).toBeNull();
  });
});
