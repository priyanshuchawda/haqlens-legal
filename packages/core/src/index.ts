import {
  caseCategorySchema,
  dateCalculationResultSchema,
  groundedAnswerSchema,
  routeDecisionSchema,
  type CaseFact,
  type CaseInput,
  type DateCalculationInput,
  type DateCalculationResult,
  type FactKey,
  type GroundedAnswer,
  type GroundedQuestionInput,
  type RouteDecision,
} from '@h2s/contracts';

const requiredFacts: readonly FactKey[] = [
  'case_category',
  'jurisdiction_country',
  'jurisdiction_state',
  'worker_type',
  'event_date',
];

const supportedCategories = new Set(['unpaid_work', 'termination', 'notice_period']);

function normaliseValue(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function factMap(facts: readonly CaseFact[]): ReadonlyMap<FactKey, readonly CaseFact[]> {
  const grouped = new Map<FactKey, CaseFact[]>();

  for (const fact of facts) {
    grouped.set(fact.key, [...(grouped.get(fact.key) ?? []), fact]);
  }

  return grouped;
}

function evidenceIds(facts: readonly CaseFact[]): string[] {
  return [...new Set(facts.flatMap((fact) => fact.evidenceIds))].sort();
}

function hasConflictingValues(facts: readonly CaseFact[]): boolean {
  return new Set(facts.map((fact) => normaliseValue(fact.value))).size > 1;
}

function createDecision(decision: RouteDecision): RouteDecision {
  return Object.freeze(routeDecisionSchema.parse(decision));
}

function formatUtcDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

/** Adds an explicitly requested calendar offset only after the source anchor is user-confirmed. */
export function calculateConfirmedDate(input: DateCalculationInput): DateCalculationResult {
  if (!input.anchor.confirmed) {
    return dateCalculationResultSchema.parse({
      anchor: input.anchor,
      date: null,
      offsetDays: input.offsetDays,
      status: 'needs_human_review',
    });
  }

  const [year, month, day] = input.anchor.date.split('-').map(Number);
  const calculated = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, (day ?? 0) + input.offsetDays));
  return dateCalculationResultSchema.parse({
    anchor: input.anchor,
    date: formatUtcDate(calculated),
    offsetDays: input.offsetDays,
    status: 'confirmed',
  });
}

/** Screens direct instruction-like text before a document-grounded question can reach a provider. */
export function requiresGroundedQuestionReview(question: string): boolean {
  const normalised = question.trim().toLocaleLowerCase('en-US').replaceAll(/\s+/gu, ' ');
  return [
    /ignore (all |any |the )?(previous|prior|above) (instructions|rules)/u,
    /reveal (the )?(system|developer) (prompt|instructions)/u,
    /act as (a |an )?(system|developer|assistant)/u,
    /follow (these|my) instructions/u,
  ].some((pattern) => pattern.test(normalised));
}

const questionStopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'does',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'the',
  'this',
  'to',
  'what',
  'when',
  'where',
  'which',
]);

function tokenSet(value: string): ReadonlySet<string> {
  return new Set(
    (
      value
        .normalize('NFKC')
        .toLocaleLowerCase('en-US')
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ).filter((token) => token.length > 1 && !questionStopWords.has(token)),
  );
}

/**
 * Returns a source-exact excerpt only when a non-instruction-like question has a lexical match.
 * This deliberately does not infer rights, deadlines, or legal consequences from the document.
 */
export function answerGroundedQuestion(input: GroundedQuestionInput): GroundedAnswer {
  if (requiresGroundedQuestionReview(input.question)) {
    return { answer: null, citation: null, status: 'needs_human_review' };
  }

  const questionTokens = tokenSet(input.question);
  let bestMatch: { id: string; score: number; text: string } | undefined;

  for (const segment of input.document.segments) {
    const score = [...tokenSet(segment.text)].filter((token) => questionTokens.has(token)).length;
    if (
      score > 0 &&
      (bestMatch === undefined ||
        score > bestMatch.score ||
        (score === bestMatch.score && segment.id < bestMatch.id))
    ) {
      bestMatch = { id: segment.id, score, text: segment.text };
    }
  }

  if (bestMatch === undefined) {
    return { answer: null, citation: null, status: 'needs_human_review' };
  }

  return groundedAnswerSchema.parse({
    answer: `The document states: “${bestMatch.text}”`,
    citation: { segmentIds: [bestMatch.id] },
    status: 'answered',
  });
}

function missingFactKeys(grouped: ReadonlyMap<FactKey, readonly CaseFact[]>): FactKey[] {
  return requiredFacts.filter(
    (key) => grouped.get(key)?.some((fact) => fact.certainty === 'confirmed') !== true,
  );
}

export function routeCase(input: CaseInput): RouteDecision {
  const grouped = factMap(input.facts);
  const dangerFacts = grouped.get('immediate_danger') ?? [];

  if (
    dangerFacts.some(
      (fact) => fact.certainty === 'confirmed' && normaliseValue(fact.value) === 'yes',
    )
  ) {
    return createDecision({
      status: 'urgent_safety_exit',
      ruleId: 'safety.immediate-danger',
      actions: [
        {
          id: 'seek-immediate-help',
          label:
            'Seek immediate local emergency or crisis support before continuing this legal-information flow.',
          basis: 'safety_policy',
          policyId: 'immediate-danger-exit-v1',
        },
      ],
      missingFacts: [],
    });
  }

  const conflictingFacts = input.facts.filter(
    (fact) => fact.certainty === 'conflicting' || hasConflictingValues(grouped.get(fact.key) ?? []),
  );

  if (conflictingFacts.length > 0) {
    return createDecision({
      status: 'human_review_required',
      ruleId: 'facts.conflict',
      actions: [
        {
          id: 'resolve-conflicting-facts',
          label:
            'Keep both versions of the conflicting information and ask a qualified professional to review it.',
          basis: 'evidence',
          evidenceIds: evidenceIds(conflictingFacts),
        },
      ],
      missingFacts: [],
    });
  }

  const missingFacts = missingFactKeys(grouped);

  if (missingFacts.length > 0) {
    return createDecision({
      status: 'insufficient_information',
      ruleId: 'facts.required-missing',
      actions: [
        {
          id: 'collect-required-facts',
          label: 'Confirm the missing facts before selecting a preparation route.',
          basis: 'missing_information',
          factKeys: missingFacts,
        },
      ],
      missingFacts,
    });
  }

  const categoryFact = grouped.get('case_category')?.find((fact) => fact.certainty === 'confirmed');
  const eventDateFact = grouped.get('event_date')?.find((fact) => fact.certainty === 'confirmed');

  if (categoryFact === undefined || eventDateFact === undefined) {
    throw new Error('Required facts must be available after missing-fact validation.');
  }

  const category = caseCategorySchema.safeParse(normaliseValue(categoryFact.value));

  if (!category.success || !supportedCategories.has(category.data)) {
    return createDecision({
      status: 'unsupported_scope',
      ruleId: 'scope.unsupported-category',
      actions: [
        {
          id: 'prepare-human-handoff',
          label: 'Prepare the available documents and questions for qualified human support.',
          basis: 'safety_policy',
          policyId: 'unsupported-scope-handoff-v1',
        },
      ],
      missingFacts: [],
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(eventDateFact.value)) {
    return createDecision({
      status: 'human_review_required',
      ruleId: 'facts.ambiguous-event-date',
      actions: [
        {
          id: 'confirm-event-date',
          label:
            'Confirm the event date from the original document before relying on the timeline.',
          basis: 'evidence',
          evidenceIds: evidenceIds([eventDateFact]),
        },
      ],
      missingFacts: [],
    });
  }

  return createDecision({
    status: 'safe_preparation_route',
    ruleId: `scope.${category.data}.preparation`,
    actions: [
      {
        id: 'preserve-original-records',
        label: 'Preserve original records and avoid altering the source material.',
        basis: 'safety_policy',
        policyId: 'evidence-preservation-v1',
      },
      {
        id: 'review-evidence-linked-facts',
        label:
          'Review the evidence-linked facts before sharing a preparation packet with a professional.',
        basis: 'evidence',
        evidenceIds: evidenceIds(input.facts),
      },
    ],
    missingFacts: [],
  });
}
