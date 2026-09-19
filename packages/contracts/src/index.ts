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

export const transcriptionPageSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    page: z.number().int().positive(),
    text: z.string().trim().min(1).max(MAX_DOCUMENT_CHARS),
  })
  .strict();

export const transcriptionReviewSchema = z
  .object({
    confirmed: z.boolean(),
    pages: z.array(transcriptionPageSchema).min(1).max(250),
    sourceLabel: z.string().trim().min(1).max(200),
  })
  .strict()
  .superRefine((review, context) => {
    if (new Set(review.pages.map((page) => page.page)).size === review.pages.length) return;
    context.addIssue({ code: 'custom', message: 'A transcription must not repeat a page number.' });
  });

export const transcriptionRequestSchema = z
  .object({
    dataBase64: z
      .string()
      .min(4)
      .max(14_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
    mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
    sourceLabel: z.string().trim().min(1).max(200),
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
    if (new Set(document.segments.map((segment) => segment.id)).size !== document.segments.length) {
      context.addIssue({
        code: 'custom',
        message: 'Document segment IDs must be unique.',
        path: ['segments'],
      });
    }

    for (const [index, segment] of document.segments.entries()) {
      const sourceText = document.text.slice(segment.sourceStart, segment.sourceEnd);
      if (sourceText === segment.text) continue;

      context.addIssue({
        code: 'custom',
        message: 'Document segment text must exactly match its source range.',
        path: ['segments', index, 'text'],
      });
    }
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

export const briefItemSchema = z
  .object({
    citation: documentCitationSchema,
    kind: z.enum(['summary', 'risk', 'uncertainty', 'professional_question']),
    severity: z.enum(['low', 'medium', 'high']).nullable(),
    text: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const documentBriefSchema = z
  .object({
    document: segmentedDocumentSchema,
    items: z.array(briefItemSchema).min(1).max(50),
  })
  .strict()
  .superRefine((brief, context) => {
    const segmentIds = new Set(brief.document.segments.map((segment) => segment.id));
    for (const [index, item] of brief.items.entries()) {
      if (item.citation.segmentIds.every((id) => segmentIds.has(id))) continue;
      context.addIssue({
        code: 'custom',
        message: 'Every brief citation must refer to a document segment.',
        path: ['items', index, 'citation', 'segmentIds'],
      });
    }
  });

const comparisonSegmentIdsSchema = z
  .array(boundedIdentifierSchema.regex(/^segment-[1-9]\d*$/u))
  .min(1)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'A comparison source list must not repeat a segment ID.',
  });

export const documentComparisonChangeSchema = z
  .object({
    kind: z.enum(['added', 'removed', 'changed']),
    leftSegmentIds: comparisonSegmentIdsSchema.nullable(),
    rightSegmentIds: comparisonSegmentIdsSchema.nullable(),
  })
  .strict()
  .superRefine((change, context) => {
    const hasLeft = change.leftSegmentIds !== null;
    const hasRight = change.rightSegmentIds !== null;
    const expected =
      (change.kind === 'added' && !hasLeft && hasRight) ||
      (change.kind === 'removed' && hasLeft && !hasRight) ||
      (change.kind === 'changed' && hasLeft && hasRight);
    if (expected) return;

    context.addIssue({
      code: 'custom',
      message: 'Comparison change sources must match the declared change kind.',
    });
  });

export const documentComparisonSchema = z
  .object({
    changes: z.array(documentComparisonChangeSchema).max(MAX_DOCUMENT_SEGMENTS * 2),
    left: segmentedDocumentSchema,
    right: segmentedDocumentSchema,
  })
  .strict()
  .superRefine((comparison, context) => {
    const leftSegmentIds = new Set(comparison.left.segments.map((segment) => segment.id));
    const rightSegmentIds = new Set(comparison.right.segments.map((segment) => segment.id));
    for (const [index, change] of comparison.changes.entries()) {
      if (change.leftSegmentIds?.every((id) => leftSegmentIds.has(id)) === false) {
        context.addIssue({
          code: 'custom',
          message: 'Every left comparison source must refer to the left document.',
          path: ['changes', index, 'leftSegmentIds'],
        });
      }
      if (change.rightSegmentIds?.every((id) => rightSegmentIds.has(id)) === false) {
        context.addIssue({
          code: 'custom',
          message: 'Every right comparison source must refer to the right document.',
          path: ['changes', index, 'rightSegmentIds'],
        });
      }
    }
  });

export const documentComparisonInputSchema = z
  .object({ left: segmentedDocumentSchema, right: segmentedDocumentSchema })
  .strict();

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .superRefine((value, context) => {
    const [year, month, day] = value.split('-').map(Number);
    const timestamp = Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0);
    const date = new Date(timestamp);
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === (month ?? 0) - 1 &&
      date.getUTCDate() === day
    )
      return;
    context.addIssue({ code: 'custom', message: 'A date must be a real ISO calendar date.' });
  });

export const dateCalculationInputSchema = z
  .object({
    anchor: z
      .object({
        confirmed: z.boolean(),
        date: isoDateSchema,
        citation: documentCitationSchema,
      })
      .strict(),
    offsetDays: z.number().int().min(0).max(3_650),
  })
  .strict();

export const dateCalculationResultSchema = z
  .object({
    anchor: dateCalculationInputSchema.shape.anchor,
    date: isoDateSchema.nullable(),
    offsetDays: z.number().int().min(0).max(3_650),
    status: z.enum(['confirmed', 'needs_human_review']),
  })
  .strict()
  .superRefine((result, context) => {
    const confirmed = result.anchor.confirmed;
    if (
      (confirmed && result.status === 'confirmed' && result.date !== null) ||
      (!confirmed && result.status === 'needs_human_review' && result.date === null)
    )
      return;
    context.addIssue({
      code: 'custom',
      message: 'A calculated date requires an explicitly confirmed anchor.',
    });
  });

export const groundedQuestionInputSchema = z
  .object({
    document: segmentedDocumentSchema,
    question: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const groundedAnswerSchema = z
  .object({
    answer: z.string().trim().min(1).max(2_000).nullable(),
    citation: documentCitationSchema.nullable(),
    status: z.enum(['answered', 'needs_human_review']),
  })
  .strict()
  .superRefine((answer, context) => {
    const valid =
      (answer.status === 'answered' && answer.answer !== null && answer.citation !== null) ||
      (answer.status === 'needs_human_review' &&
        answer.answer === null &&
        answer.citation === null);
    if (valid) return;
    context.addIssue({
      code: 'custom',
      message: 'An answer must be cited, and a review result must not invent an answer.',
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
export type TranscriptionReview = z.infer<typeof transcriptionReviewSchema>;
export type TranscriptionRequest = z.infer<typeof transcriptionRequestSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type DocumentBrief = z.infer<typeof documentBriefSchema>;
export type DocumentComparison = z.infer<typeof documentComparisonSchema>;
export type DocumentComparisonInput = z.infer<typeof documentComparisonInputSchema>;
export type DateCalculationInput = z.infer<typeof dateCalculationInputSchema>;
export type DateCalculationResult = z.infer<typeof dateCalculationResultSchema>;
export type GroundedQuestionInput = z.infer<typeof groundedQuestionInputSchema>;
export type GroundedAnswer = z.infer<typeof groundedAnswerSchema>;
export type SegmentedDocument = z.infer<typeof segmentedDocumentSchema>;
export type OfficialSource = z.infer<typeof officialSourceSchema>;
export type OfficialSourceTopic = z.infer<typeof officialSourceTopicSchema>;
export type ExtractionResult = z.infer<typeof factExtractionOutputSchema>;
export type FactKey = z.infer<typeof factKeySchema>;
export type RouteDecision = z.infer<typeof routeDecisionSchema>;
