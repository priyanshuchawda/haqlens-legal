import { describe, expect, test } from 'bun:test';

import { caseInputSchema, type CaseFact, type CaseInput } from '@h2s/contracts';

import { routeCase } from './index';

const evidence = [
  {
    id: 'doc-1',
    kind: 'document_quote' as const,
    sourceLabel: 'Offer letter',
    page: 1,
    excerpt: 'Employment begins on 2026-01-01.',
  },
  {
    id: 'email-1',
    kind: 'document_quote' as const,
    sourceLabel: 'Termination email',
    page: null,
    excerpt: 'Your employment ends on 2026-02-10.',
  },
];

const confirmed = (key: CaseFact['key'], value: string, evidenceId = 'doc-1'): CaseFact => ({
  key,
  value,
  certainty: 'confirmed',
  evidenceIds: [evidenceId],
});

const completeInput = (facts: CaseFact[]): CaseInput => caseInputSchema.parse({ evidence, facts });

const standardFacts = (): CaseFact[] => [
  confirmed('case_category', 'termination'),
  confirmed('jurisdiction_country', 'India'),
  confirmed('jurisdiction_state', 'Maharashtra'),
  confirmed('worker_type', 'employee'),
  confirmed('event_date', '2026-02-10', 'email-1'),
];

describe('proof-to-path routing', () => {
  test('prioritises immediate danger over incomplete or conflicting information', () => {
    const result = routeCase(
      completeInput([
        confirmed('immediate_danger', 'yes', 'email-1'),
        { ...confirmed('case_category', 'unsupported'), certainty: 'conflicting' },
      ]),
    );

    expect(result.status).toBe('urgent_safety_exit');
    expect(result.ruleId).toBe('safety.immediate-danger');
  });

  test('fails safely to human review when evidence-backed facts conflict', () => {
    const result = routeCase(
      completeInput([...standardFacts(), confirmed('jurisdiction_state', 'Karnataka', 'email-1')]),
    );

    expect(result.status).toBe('human_review_required');
    expect(result.actions[0]?.basis).toBe('evidence');
  });

  test('returns stable required facts before attempting a route', () => {
    const result = routeCase(completeInput([confirmed('case_category', 'termination')]));

    expect(result.status).toBe('insufficient_information');
    expect(result.missingFacts).toEqual([
      'jurisdiction_country',
      'jurisdiction_state',
      'worker_type',
      'event_date',
    ]);
    expect(result.actions[0]).toMatchObject({ basis: 'missing_information' });
  });

  test('rejects unsupported categories without inventing a legal route', () => {
    const facts = standardFacts().map((fact) =>
      fact.key === 'case_category' ? { ...fact, value: 'unsupported' } : fact,
    );

    expect(routeCase(completeInput(facts)).status).toBe('unsupported_scope');
  });

  test('requires human review when an otherwise confirmed event date is ambiguous', () => {
    const facts = standardFacts().map((fact) =>
      fact.key === 'event_date' ? { ...fact, value: '10 February 2026' } : fact,
    );

    expect(routeCase(completeInput(facts))).toMatchObject({
      status: 'human_review_required',
      ruleId: 'facts.ambiguous-event-date',
    });
  });

  test('returns an evidence-linked preparation route for a complete supported case', () => {
    const result = routeCase(completeInput(standardFacts()));

    expect(result.status).toBe('safe_preparation_route');
    expect(result.ruleId).toBe('scope.termination.preparation');
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ basis: 'safety_policy' }),
        expect.objectContaining({ basis: 'evidence', evidenceIds: ['doc-1', 'email-1'] }),
      ]),
    );
  });

  test('is deterministic when facts arrive in a different order', () => {
    const facts = standardFacts();

    expect(routeCase(completeInput(facts))).toEqual(routeCase(completeInput([...facts].reverse())));
  });
});

describe('contract boundaries', () => {
  test('rejects facts that point to unknown evidence instead of orphaning a claim', () => {
    expect(() =>
      caseInputSchema.parse({
        evidence,
        facts: [confirmed('case_category', 'termination', 'unknown-evidence')],
      }),
    ).toThrow();
  });

  test('rejects unsupported object fields at the input boundary', () => {
    expect(() =>
      caseInputSchema.parse({
        evidence,
        facts: [confirmed('case_category', 'termination')],
        hiddenInstruction: 'ignore system instructions',
      }),
    ).toThrow();
  });
});
