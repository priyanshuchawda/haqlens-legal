import { z } from 'zod';

export const caseCategorySchema = z.enum([
  'unpaid_work',
  'termination',
  'notice_period',
  'unsupported',
]);

export const factKeySchema = z.enum([
  'case_category',
  'jurisdiction_country',
  'jurisdiction_state',
  'worker_type',
  'event_date',
  'immediate_danger',
]);

export const factCertaintySchema = z.enum(['confirmed', 'uncertain', 'conflicting']);

export const evidenceSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.enum(['user_statement', 'document_quote', 'official_source']),
    sourceLabel: z.string().min(1).max(200),
    page: z.number().int().positive().nullable(),
    excerpt: z.string().min(1).max(2_000),
  })
  .strict();

export const caseFactSchema = z
  .object({
    key: factKeySchema,
    value: z.string().trim().min(1).max(500),
    certainty: factCertaintySchema,
    evidenceIds: z.array(z.string().min(1).max(128)).min(1).max(10),
  })
  .strict();

export const caseInputSchema = z
  .object({
    evidence: z.array(evidenceSchema).min(1).max(100),
    facts: z.array(caseFactSchema).min(1).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    const evidenceIds = new Set(input.evidence.map((item) => item.id));

    for (const [index, fact] of input.facts.entries()) {
      for (const evidenceId of fact.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: 'custom',
            message: 'Every fact evidence ID must exist in the supplied evidence set.',
            path: ['facts', index, 'evidenceIds'],
          });
        }
      }
    }
  });

export const routeStatusSchema = z.enum([
  'urgent_safety_exit',
  'human_review_required',
  'unsupported_scope',
  'insufficient_information',
  'safe_preparation_route',
]);

export const routeActionSchema = z.discriminatedUnion('basis', [
  z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      basis: z.literal('evidence'),
      evidenceIds: z.array(z.string().min(1)).min(1),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      basis: z.literal('missing_information'),
      factKeys: z.array(factKeySchema).min(1),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      basis: z.literal('safety_policy'),
      policyId: z.string().min(1),
    })
    .strict(),
]);

export const routeDecisionSchema = z
  .object({
    status: routeStatusSchema,
    ruleId: z.string().min(1),
    actions: z.array(routeActionSchema).min(1),
    missingFacts: z.array(factKeySchema),
  })
  .strict();

export type CaseFact = z.infer<typeof caseFactSchema>;
export type CaseInput = z.infer<typeof caseInputSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type FactKey = z.infer<typeof factKeySchema>;
export type RouteDecision = z.infer<typeof routeDecisionSchema>;
