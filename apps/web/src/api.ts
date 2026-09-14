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
    fact.evidenceIds.every((id) => typeof id === 'string')
  );
}

export function extractionFromResponse(
  value: unknown,
): { source: 'fixture' | 'gemini'; facts: Fact[] } | null {
  if (typeof value !== 'object' || value === null) return null;
  const response = value as Record<string, unknown>;
  if (
    (response.source !== 'fixture' && response.source !== 'gemini') ||
    response.safeMode !== false ||
    !Array.isArray(response.facts) ||
    !response.facts.every(isFact)
  )
    return null;
  return { source: response.source, facts: response.facts };
}

export function routeFromResponse(value: unknown): RouteDecision | null {
  if (typeof value !== 'object' || value === null) return null;
  const response = value as Record<string, unknown>;
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
    !Array.isArray(response.actions) ||
    !Array.isArray(response.missingFacts)
  )
    return null;
  if (
    !response.actions.every(
      (action) =>
        typeof action === 'object' &&
        action !== null &&
        typeof (action as Record<string, unknown>).id === 'string' &&
        typeof (action as Record<string, unknown>).label === 'string',
    )
  )
    return null;
  if (
    !response.missingFacts.every(
      (key) => typeof key === 'string' && factKeys.includes(key as FactKey),
    )
  )
    return null;
  return response as RouteDecision;
}
