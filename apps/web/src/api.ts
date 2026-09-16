export const factKeys = [
  'case_category',
  'jurisdiction_country',
  'jurisdiction_state',
  'worker_type',
  'event_date',
  'immediate_danger',
] as const;

export type FactKey = (typeof factKeys)[number];
export type Certainty = 'confirmed' | 'uncertain' | 'conflicting';
export type Fact = Readonly<{
  key: FactKey;
  value: string;
  certainty: Certainty;
  evidenceIds: string[];
}>;
export type RouteDecision = Readonly<{
  status:
    | 'urgent_safety_exit'
    | 'human_review_required'
    | 'unsupported_scope'
    | 'insufficient_information'
    | 'safe_preparation_route';
  ruleId: string;
  actions: Array<Readonly<{ id: string; label: string }>>;
  missingFacts: FactKey[];
}>;

export type SourceDocument = Readonly<{
  sourceLabel: string;
  text: string;
  segments: ReadonlyArray<
    Readonly<{
      id: string;
      page: number | null;
      sourceStart: number;
      sourceEnd: number;
      text: string;
    }>
  >;
}>;

export type DocumentBrief = Readonly<{
  document: SourceDocument;
  items: ReadonlyArray<
    Readonly<{
      citation: Readonly<{ segmentIds: string[] }>;
      kind: 'summary' | 'risk' | 'uncertainty' | 'professional_question';
      severity: 'low' | 'medium' | 'high' | null;
      text: string;
    }>
  >;
}>;

export type DocumentComparison = Readonly<{
  left: SourceDocument;
  right: SourceDocument;
  changes: ReadonlyArray<
    Readonly<{
      kind: 'added' | 'removed' | 'changed';
      leftSegmentIds: string[] | null;
      rightSegmentIds: string[] | null;
    }>
  >;
}>;

export type DateCalculationResult = Readonly<{
  anchor: Readonly<{
    confirmed: boolean;
    date: string;
    citation: Readonly<{ segmentIds: readonly string[] }>;
  }>;
  date: string | null;
  offsetDays: number;
  status: 'confirmed' | 'needs_human_review';
}>;

export function privateJsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function normaliseEvidenceText(value: string): string | null {
  const normalised = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  const hasUnsafeControlCharacter = [...normalised].some((character) => {
    const code = character.charCodeAt(0);
    return code === 127 || (code < 32 && code !== 9 && code !== 10);
  });
  return hasUnsafeControlCharacter ? null : normalised;
}

export function retryAfterSeconds(response: Response): number | null {
  if (response.status !== 429) return null;
  const value = Number(response.headers.get('retry-after'));
  return Number.isSafeInteger(value) && value >= 1 && value <= 3_600 ? value : null;
}

function isFact(value: unknown): value is Fact {
  if (typeof value !== 'object' || value === null) return false;
  const fact = value as Record<string, unknown>;
  return (
    typeof fact.key === 'string' &&
    factKeys.includes(fact.key as FactKey) &&
    typeof fact.value === 'string' &&
    (fact.certainty === 'confirmed' ||
      fact.certainty === 'uncertain' ||
      fact.certainty === 'conflicting') &&
    Array.isArray(fact.evidenceIds) &&
    fact.evidenceIds.every((id) => typeof id === 'string') &&
    new Set(fact.evidenceIds).size === fact.evidenceIds.length
  );
}

export function extractionFromResponse(
  value: unknown,
  submittedEvidenceIds: ReadonlySet<string>,
): { source: 'fixture' | 'gemini'; facts: Fact[] } | null {
  if (typeof value !== 'object' || value === null) return null;
  const response = value as Record<string, unknown>;
  if (
    (response.source !== 'fixture' && response.source !== 'gemini') ||
    response.safeMode !== false ||
    !Array.isArray(response.facts) ||
    !response.facts.every(
      (fact) =>
        isFact(fact) &&
        fact.evidenceIds.every((evidenceId) => submittedEvidenceIds.has(evidenceId)),
    )
  )
    return null;
  return { source: response.source, facts: response.facts };
}

function isRouteAction(value: unknown): value is Readonly<{ id: string; label: string }> {
  if (typeof value !== 'object' || value === null) return false;
  const action = value as Record<string, unknown>;
  return (
    typeof action.id === 'string' &&
    action.id.length >= 1 &&
    action.id.length <= 128 &&
    typeof action.label === 'string' &&
    action.label.length >= 1 &&
    action.label.length <= 500
  );
}

export function routeFromResponse(value: unknown): RouteDecision | null {
  if (typeof value !== 'object' || value === null) return null;
  const response = value as Record<string, unknown>;
  const actions = response.actions;
  const missingFacts = response.missingFacts;
  const statuses: readonly RouteDecision['status'][] = [
    'urgent_safety_exit',
    'human_review_required',
    'unsupported_scope',
    'insufficient_information',
    'safe_preparation_route',
  ];
  if (
    !statuses.includes(response.status as RouteDecision['status']) ||
    typeof response.ruleId !== 'string' ||
    response.ruleId.length < 1 ||
    response.ruleId.length > 128 ||
    !Array.isArray(actions) ||
    actions.length < 1 ||
    actions.length > 10 ||
    !Array.isArray(missingFacts)
  )
    return null;
  if (!actions.every(isRouteAction)) return null;
  if (
    missingFacts.length > 6 ||
    !missingFacts.every((key) => typeof key === 'string' && factKeys.includes(key as FactKey)) ||
    new Set(actions.map((action) => action.id)).size !== actions.length ||
    new Set(missingFacts).size !== missingFacts.length
  )
    return null;
  return response as RouteDecision;
}

function isExactDocument(value: unknown, submitted: SourceDocument): value is SourceDocument {
  if (typeof value !== 'object' || value === null) return false;
  const document = value as Record<string, unknown>;
  if (
    document.sourceLabel !== submitted.sourceLabel ||
    document.text !== submitted.text ||
    !Array.isArray(document.segments) ||
    document.segments.length !== submitted.segments.length
  )
    return false;

  return document.segments.every((segment, index) => {
    const expected = submitted.segments[index];
    if (expected === undefined || typeof segment !== 'object' || segment === null) return false;
    const candidate = segment as Record<string, unknown>;
    return (
      candidate.id === expected.id &&
      candidate.page === expected.page &&
      candidate.sourceStart === expected.sourceStart &&
      candidate.sourceEnd === expected.sourceEnd &&
      candidate.text === expected.text
    );
  });
}

function isBriefItem(value: unknown, segmentIds: ReadonlySet<string>): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  const citation = item.citation;
  const kinds = ['summary', 'risk', 'uncertainty', 'professional_question'];
  const severities = ['low', 'medium', 'high'];
  if (
    !kinds.includes(item.kind as string) ||
    !(item.severity === null || severities.includes(item.severity as string)) ||
    typeof item.text !== 'string' ||
    item.text.trim().length !== item.text.length ||
    item.text.length < 1 ||
    item.text.length > 1_000 ||
    typeof citation !== 'object' ||
    citation === null
  )
    return false;
  const citationIds = (citation as Record<string, unknown>).segmentIds;
  return (
    Array.isArray(citationIds) &&
    citationIds.length >= 1 &&
    citationIds.length <= 10 &&
    citationIds.every((id) => typeof id === 'string' && segmentIds.has(id)) &&
    new Set(citationIds).size === citationIds.length
  );
}

/** Accepts only a response that preserves the submitted citation targets exactly. */
export function documentBriefFromResponse(
  value: unknown,
  submittedDocument: SourceDocument,
): DocumentBrief | null {
  if (typeof value !== 'object' || value === null) return null;
  const response = value as Record<string, unknown>;
  if (!isExactDocument(response.document, submittedDocument) || !Array.isArray(response.items)) {
    return null;
  }
  const segmentIds = new Set(submittedDocument.segments.map((segment) => segment.id));
  if (
    response.items.length < 1 ||
    response.items.length > 50 ||
    !response.items.every((item) => isBriefItem(item, segmentIds))
  )
    return null;
  return response as DocumentBrief;
}

function isComparisonSegmentIds(value: unknown, validIds: ReadonlySet<string>): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 10 &&
    value.every((id) => typeof id === 'string' && validIds.has(id)) &&
    new Set(value).size === value.length
  );
}

function isComparisonChange(
  value: unknown,
  leftIds: ReadonlySet<string>,
  rightIds: ReadonlySet<string>,
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const change = value as Record<string, unknown>;
  const left = change.leftSegmentIds;
  const right = change.rightSegmentIds;
  if (change.kind === 'added') return left === null && isComparisonSegmentIds(right, rightIds);
  if (change.kind === 'removed') return isComparisonSegmentIds(left, leftIds) && right === null;
  return (
    change.kind === 'changed' &&
    isComparisonSegmentIds(left, leftIds) &&
    isComparisonSegmentIds(right, rightIds)
  );
}

/** Accepts only a deterministic comparison that preserves both submitted documents exactly. */
export function documentComparisonFromResponse(
  value: unknown,
  submittedLeft: SourceDocument,
  submittedRight: SourceDocument,
): DocumentComparison | null {
  if (typeof value !== 'object' || value === null) return null;
  const response = value as Record<string, unknown>;
  if (
    !isExactDocument(response.left, submittedLeft) ||
    !isExactDocument(response.right, submittedRight) ||
    !Array.isArray(response.changes) ||
    response.changes.length > 500
  )
    return null;
  const leftIds = new Set(submittedLeft.segments.map((segment) => segment.id));
  const rightIds = new Set(submittedRight.segments.map((segment) => segment.id));
  if (!response.changes.every((change) => isComparisonChange(change, leftIds, rightIds)))
    return null;
  return response as DocumentComparison;
}

function isRealIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === (month ?? 0) - 1 &&
    date.getUTCDate() === day
  );
}

/** Accepts only an exact response for the submitted source anchor and requested offset. */
export function dateCalculationFromResponse(
  value: unknown,
  submitted: Readonly<{
    anchor: Readonly<{
      confirmed: boolean;
      date: string;
      citation: Readonly<{ segmentIds: readonly string[] }>;
    }>;
    offsetDays: number;
  }>,
): DateCalculationResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const result = value as Record<string, unknown>;
  const anchor = result.anchor;
  if (typeof anchor !== 'object' || anchor === null) return null;
  const receivedAnchor = anchor as Record<string, unknown>;
  const citation = receivedAnchor.citation;
  if (
    receivedAnchor.confirmed !== submitted.anchor.confirmed ||
    receivedAnchor.date !== submitted.anchor.date ||
    typeof citation !== 'object' ||
    citation === null ||
    !Array.isArray((citation as Record<string, unknown>).segmentIds) ||
    JSON.stringify((citation as Record<string, unknown>).segmentIds) !==
      JSON.stringify(submitted.anchor.citation.segmentIds) ||
    result.offsetDays !== submitted.offsetDays
  )
    return null;
  if (submitted.anchor.confirmed && result.status === 'confirmed' && isRealIsoDate(result.date))
    return result as DateCalculationResult;
  if (
    !submitted.anchor.confirmed &&
    result.status === 'needs_human_review' &&
    result.date === null
  ) {
    return result as DateCalculationResult;
  }
  return null;
}
