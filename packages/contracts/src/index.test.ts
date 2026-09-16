import { describe, expect, test } from 'bun:test';
import {
  caseInputSchema,
  documentCitationSchema,
  documentBriefSchema,
  documentTextInputSchema,
  factExtractionInputSchema,
  officialSourceSchema,
  segmentedDocumentSchema,
  routeDecisionSchema,
} from './index';

const evidence = {
  id: 'document-1',
  kind: 'document_quote',
  sourceLabel: 'Termination email',
  page: null,
  excerpt: 'Employment ends on 2026-02-10.',
} as const;

describe('evidence-link contracts', () => {
  test('accept distinct evidence IDs and fact links', () => {
    expect(
      caseInputSchema.safeParse({
        evidence: [evidence, { ...evidence, id: 'document-2' }],
        facts: [
          {
            key: 'event_date',
            value: '2026-02-10',
            certainty: 'confirmed',
            evidenceIds: ['document-1', 'document-2'],
          },
        ],
      }).success,
    ).toBe(true);
  });

  test('reject duplicate evidence IDs and fact links', () => {
    expect(factExtractionInputSchema.safeParse({ evidence: [evidence, evidence] }).success).toBe(
      false,
    );
    expect(
      caseInputSchema.safeParse({
        evidence: [evidence, evidence],
        facts: [
          {
            key: 'event_date',
            value: '2026-02-10',
            certainty: 'confirmed',
            evidenceIds: ['document-1'],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      caseInputSchema.safeParse({
        evidence: [evidence],
        facts: [
          {
            key: 'event_date',
            value: '2026-02-10',
            certainty: 'confirmed',
            evidenceIds: ['document-1', 'document-1'],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('route decision contracts', () => {
  const action = {
    id: 'preserve-original-records',
    label: 'Preserve original records.',
    basis: 'safety_policy',
    policyId: 'evidence-preservation-v1',
  } as const;

  test('accepts bounded unique route rendering fields', () => {
    expect(
      routeDecisionSchema.safeParse({
        status: 'safe_preparation_route',
        ruleId: 'scope.termination.preparation',
        actions: [action],
        missingFacts: [],
      }).success,
    ).toBe(true);
  });

  test('rejects oversized and duplicate route rendering fields', () => {
    expect(
      routeDecisionSchema.safeParse({
        status: 'safe_preparation_route',
        ruleId: 'x'.repeat(129),
        actions: [action],
        missingFacts: [],
      }).success,
    ).toBe(false);
    expect(
      routeDecisionSchema.safeParse({
        status: 'safe_preparation_route',
        ruleId: 'scope.termination.preparation',
        actions: [action, action],
        missingFacts: [],
      }).success,
    ).toBe(false);
    expect(
      routeDecisionSchema.safeParse({
        status: 'safe_preparation_route',
        ruleId: 'scope.termination.preparation',
        actions: [action],
        missingFacts: ['event_date', 'event_date'],
      }).success,
    ).toBe(false);
  });
});

describe('document citation contracts', () => {
  const segment = {
    id: 'segment-1',
    page: null,
    sourceEnd: 12,
    sourceStart: 0,
    text: 'Payment is due.',
  } as const;

  test('accept bounded source-linked document segments', () => {
    expect(
      segmentedDocumentSchema.safeParse({
        sourceLabel: 'Offer letter',
        text: 'Payment is due.',
        segments: [segment],
      }).success,
    ).toBe(true);
    expect(documentCitationSchema.safeParse({ segmentIds: ['segment-1'] }).success).toBe(true);
  });

  test('reject duplicate, malformed, and impossible source links', () => {
    expect(
      segmentedDocumentSchema.safeParse({
        sourceLabel: 'Offer letter',
        text: 'Payment is due.',
        segments: [segment, segment],
      }).success,
    ).toBe(false);
    expect(
      segmentedDocumentSchema.safeParse({
        sourceLabel: 'Offer letter',
        text: 'Payment is due.',
        segments: [{ ...segment, sourceEnd: 0 }],
      }).success,
    ).toBe(false);
    expect(
      documentCitationSchema.safeParse({ segmentIds: ['segment-1', 'segment-1'] }).success,
    ).toBe(false);
    expect(documentCitationSchema.safeParse({ segmentIds: ['provider-invented'] }).success).toBe(
      false,
    );
    expect(
      documentTextInputSchema.safeParse({ sourceLabel: 'Offer letter', text: 'x', extra: 1 })
        .success,
    ).toBe(false);
  });
});

describe('official-source contracts', () => {
  const source = {
    authority: 'National Legal Services Authority',
    id: 'official-nalsa-legal-aid',
    reviewedOn: '2026-09-17',
    title: 'Legal Aid',
    topics: ['legal_aid'],
    url: 'https://nalsa.gov.in/legal-aid/',
  } as const;

  test('accepts bounded reviewed official-source provenance', () => {
    expect(officialSourceSchema.safeParse(source).success).toBe(true);
  });

  test('rejects duplicate topics and non-HTTPS source URLs', () => {
    expect(
      officialSourceSchema.safeParse({ ...source, topics: ['legal_aid', 'legal_aid'] }).success,
    ).toBe(false);
    expect(
      officialSourceSchema.safeParse({ ...source, url: 'http://nalsa.gov.in/legal-aid/' }).success,
    ).toBe(false);
  });
});

describe('cited brief contracts', () => {
  const document = {
    sourceLabel: 'Notice',
    text: 'Payment is due.',
    segments: [
      { id: 'segment-1', page: null, sourceStart: 0, sourceEnd: 15, text: 'Payment is due.' },
    ],
  };

  test('reject orphaned citations before a brief can render', () => {
    expect(
      documentBriefSchema.safeParse({
        document,
        items: [
          {
            kind: 'risk',
            severity: 'high',
            text: 'Payment risk.',
            citation: { segmentIds: ['segment-1'] },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      documentBriefSchema.safeParse({
        document,
        items: [
          {
            kind: 'risk',
            severity: 'high',
            text: 'Payment risk.',
            citation: { segmentIds: ['segment-2'] },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
