import { describe, expect, test } from 'bun:test';
import { caseInputSchema, factExtractionInputSchema } from './index';

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
