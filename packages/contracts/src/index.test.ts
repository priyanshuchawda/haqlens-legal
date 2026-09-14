import { describe, expect, test } from 'bun:test';
import { caseInputSchema, factExtractionInputSchema, routeDecisionSchema } from './index';

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
