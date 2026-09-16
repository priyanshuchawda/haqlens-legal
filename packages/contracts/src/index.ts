import { z } from 'zod';

export const MAX_DOCUMENT_CHARS = 60_000;
export const MAX_DOCUMENT_SEGMENTS = 250;
export const MAX_SEGMENT_CHARS = 2_000;

const boundedIdentifierSchema = z.string().min(1).max(128);

export const documentTextInputSchema = z
  .object({
    sourceLabel: z.string().trim().min(1).max(200),
    text: z.string().min(1).max(MAX_DOCUMENT_CHARS),
  })
  .strict();

export const documentSegmentSchema = z
  .object({
    id: boundedIdentifierSchema.regex(/^segment-[1-9]\d*$/u),
    page: z.number().int().positive().nullable(),
    sourceEnd: z.number().int().positive().max(MAX_DOCUMENT_CHARS),
    sourceStart: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_DOCUMENT_CHARS - 1),
    text: z.string().min(1).max(MAX_SEGMENT_CHARS),
  })
  .strict()
  .superRefine((segment, context) => {
    if (segment.sourceEnd > segment.sourceStart) return;

    context.addIssue({
      code: 'custom',
      message: 'A segment source range must have a positive length.',
      path: ['sourceEnd'],
    });
  });

export const segmentedDocumentSchema = z
  .object({
    segments: z.array(documentSegmentSchema).min(1).max(MAX_DOCUMENT_SEGMENTS),
    sourceLabel: z.string().trim().min(1).max(200),
    text: z.string().min(1).max(MAX_DOCUMENT_CHARS),
  })
  .strict()
  .superRefine((document, context) => {
    if (new Set(document.segments.map((segment) => segment.id)).size === document.segments.length)
      return;

    context.addIssue({
      code: 'custom',
      message: 'Document segment IDs must be unique.',
      path: ['segments'],
    });
  });

export const documentCitationSchema = z
  .object({
    segmentIds: z
      .array(boundedIdentifierSchema.regex(/^segment-[1-9]\d*$/u))
      .min(1)
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'A citation must not repeat a segment ID.',
      }),
  })
  .strict();

export const officialSourceTopicSchema = z.enum([
  'consumer_dispute',
  'employment_dispute',
  'legal_aid',
  'public_grievance',
]);

export const officialSourceSchema = z
  .object({
    authority: z.string().trim().min(1).max(200),
    id: boundedIdentifierSchema.regex(/^official-[a-z0-9-]+$/u),
    reviewedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    title: z.string().trim().min(1).max(200),
    topics: z.array(officialSourceTopicSchema).min(1).max(4),
    url: z.string().url().max(500),
  })
  .strict()
  .superRefine((source, context) => {
    if (new URL(source.url).protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        message: 'An official source URL must use HTTPS.',
        path: ['url'],
      });
    }

    if (new Set(source.topics).size === source.topics.length) return;

    context.addIssue({
      code: 'custom',
      message: 'An official source must not repeat a topic.',
      path: ['topics'],
    });
  });

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
    evidenceIds: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'A fact must not repeat an evidence ID.',
      }),
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

    if (evidenceIds.size !== input.evidence.length) {
      context.addIssue({
        code: 'custom',
        message: 'Evidence IDs must be unique.',
        path: ['evidence'],
      });
    }

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

export const factExtractionInputSchema = z
  .object({
    evidence: z.array(evidenceSchema).min(1).max(20),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.evidence.map((item) => item.id)).size === input.evidence.length) return;

    context.addIssue({
      code: 'custom',
      message: 'Evidence IDs must be unique.',
      path: ['evidence'],
    });
  });

export const factExtractionOutputSchema = z
  .object({
    facts: z.array(caseFactSchema).max(30),
  })
  .strict();

export const extractionSourceSchema = z.enum(['fixture', 'gemini']);

export const extractionSuccessSchema = z
  .object({
    source: extractionSourceSchema,
    safeMode: z.literal(false),
    facts: z.array(caseFactSchema).max(30),
  })
  .strict();

export const extractionSafeModeSchema = z
  .object({
    source: z.enum(['disabled', 'gemini']),
    safeMode: z.literal(true),
    error: z.literal('rule_only_safe_mode'),
    facts: z.array(caseFactSchema).length(0),
  })
  .strict();

export const routeActionSchema = z.discriminatedUnion('basis', [
  z
    .object({
      id: z.string().min(1).max(128),
      label: z.string().min(1).max(500),
      basis: z.literal('evidence'),
      evidenceIds: z
        .array(z.string().min(1).max(128))
        .min(1)
        .max(10)
        .refine((ids) => new Set(ids).size === ids.length, {
          message: 'An action must not repeat an evidence ID.',
        }),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(128),
      label: z.string().min(1).max(500),
      basis: z.literal('missing_information'),
      factKeys: z
        .array(factKeySchema)
        .min(1)
        .max(6)
        .refine((keys) => new Set(keys).size === keys.length, {
          message: 'An action must not repeat a fact key.',
        }),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(128),
      label: z.string().min(1).max(500),
      basis: z.literal('safety_policy'),
      policyId: z.string().min(1).max(128),
    })
    .strict(),
]);

export const routeDecisionSchema = z
  .object({
    status: routeStatusSchema,
    ruleId: z.string().min(1).max(128),
    actions: z.array(routeActionSchema).min(1).max(10),
    missingFacts: z
      .array(factKeySchema)
      .max(6)
      .refine((keys) => new Set(keys).size === keys.length, {
        message: 'A route must not repeat a missing fact.',
      }),
  })
  .strict()
  .superRefine((route, context) => {
    if (new Set(route.actions.map((action) => action.id)).size === route.actions.length) return;

    context.addIssue({
      code: 'custom',
      message: 'A route must not repeat an action ID.',
      path: ['actions'],
    });
  });

export type CaseFact = z.infer<typeof caseFactSchema>;
export type CaseInput = z.infer<typeof caseInputSchema>;
export type DocumentSegment = z.infer<typeof documentSegmentSchema>;
export type DocumentTextInput = z.infer<typeof documentTextInputSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type OfficialSource = z.infer<typeof officialSourceSchema>;
export type OfficialSourceTopic = z.infer<typeof officialSourceTopicSchema>;
export type ExtractionResult = z.infer<typeof factExtractionOutputSchema>;
export type FactKey = z.infer<typeof factKeySchema>;
export type RouteDecision = z.infer<typeof routeDecisionSchema>;
