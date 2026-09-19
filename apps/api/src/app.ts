import {
  caseInputSchema,
  dateCalculationInputSchema,
  dateCalculationResultSchema,
  documentComparisonInputSchema,
  documentComparisonSchema,
  documentBriefSchema,
  extractionSafeModeSchema,
  extractionSuccessSchema,
  factExtractionInputSchema,
  groundedAnswerSchema,
  groundedQuestionInputSchema,
  segmentedDocumentSchema,
  routeDecisionSchema,
  officialSourceTopicSchema,
  type CaseInput,
  type RouteDecision,
  transcriptionRequestSchema,
  transcriptionReviewSchema,
} from '@haqlens/contracts';
import type { FactExtractor } from '@haqlens/ai-gemini';
import type { Transcriber } from '@haqlens/ai-gemini';
import { answerGroundedQuestion, calculateConfirmedDate, routeCase } from '@haqlens/core';
import { compareSegmentedDocuments } from '@haqlens/document';
import { resolveOfficialSources } from '@haqlens/official-sources';
import { Hono, type Context } from 'hono';
import { createRateLimiter, type RateLimiter } from './rate-limit.js';

export const MAX_JSON_BYTES = 64 * 1024;
export const MAX_TRANSCRIPTION_JSON_BYTES = 10 * 1024 * 1024;

const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const;

type Route = (input: CaseInput) => RouteDecision;

type AppDependencies = Readonly<{
  extractionSource?: 'disabled' | 'fixture' | 'gemini';
  factExtractor?: FactExtractor;
  route?: Route;
  rateLimiter?: RateLimiter;
  transcriber?: Transcriber;
}>;

type RuntimeBindings = Readonly<{ clientKey?: string }>;

type ParsedJson = Readonly<{ payload: unknown }> | Readonly<{ response: Response }>;

function hasResponse(result: ParsedJson): result is Readonly<{ response: Response }> {
  return 'response' in result;
}

async function parseBoundedJson(context: Context, maxBytes = MAX_JSON_BYTES): Promise<ParsedJson> {
  const contentType = context.req.header('content-type')?.toLocaleLowerCase('en-US');
  const mediaType = contentType?.split(';', 1)[0]?.trim();

  if (mediaType !== 'application/json') {
    return { response: context.json({ error: 'unsupported_media_type' }, 415) };
  }

  const contentLength = Number(context.req.header('content-length'));

  if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
    return { response: context.json({ error: 'payload_too_large' }, 413) };
  }

  const body = await context.req.raw.text();

  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    return { response: context.json({ error: 'payload_too_large' }, 413) };
  }

  try {
    return { payload: JSON.parse(body) as unknown };
  } catch {
    return { response: context.json({ error: 'invalid_json' }, 400) };
  }
}

export function createApp({
  extractionSource = 'disabled',
  factExtractor,
  route = routeCase,
  rateLimiter = createRateLimiter({
    limit: 30,
    maxEntries: 10_000,
    now: Date.now,
    windowMs: 60_000,
  }),
  transcriber,
}: AppDependencies = {}) {
  const application = new Hono<{ Bindings: RuntimeBindings }>();

  application.use('*', async (context, next) => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      context.header(name, value);
    }

    await next();
  });

  application.get('/health', (context) => context.json({ status: 'ok' }));

  application.use('/v1/*', async (context, next) => {
    const result = rateLimiter.consume(context.env?.clientKey ?? 'unknown-peer');

    if (!result.allowed) {
      context.header('retry-after', String(result.retryAfterSeconds));
      return context.json({ error: 'rate_limited' }, 429);
    }

    await next();
  });

  application.post('/v1/routes/prepare', async (context) => {
    const parsed = await parseBoundedJson(context);

    if (hasResponse(parsed)) {
      return parsed.response;
    }

    const input = caseInputSchema.safeParse(parsed.payload);

    if (!input.success) {
      return context.json({ error: 'invalid_request' }, 422);
    }

    return context.json(routeDecisionSchema.parse(route(input.data)));
  });

  application.post('/v1/extractions/facts', async (context) => {
    const parsed = await parseBoundedJson(context);

    if (hasResponse(parsed)) {
      return parsed.response;
    }

    const input = factExtractionInputSchema.safeParse(parsed.payload);

    if (!input.success) {
      return context.json({ error: 'invalid_request' }, 422);
    }

    if (extractionSource === 'disabled' || factExtractor === undefined) {
      return context.json(
        extractionSafeModeSchema.parse({
          source: 'disabled',
          safeMode: true,
          error: 'rule_only_safe_mode',
          facts: [],
        }),
        503,
      );
    }

    try {
      const result = await factExtractor.extract(input.data);

      return context.json(
        extractionSuccessSchema.parse({
          source: extractionSource,
          safeMode: false,
          facts: result.facts,
        }),
      );
    } catch {
      return context.json(
        extractionSafeModeSchema.parse({
          source: extractionSource,
          safeMode: true,
          error: 'rule_only_safe_mode',
          facts: [],
        }),
        503,
      );
    }
  });

  application.post('/v1/briefs/document', async (context) => {
    const parsed = await parseBoundedJson(context);
    if (hasResponse(parsed)) return parsed.response;
    const document = segmentedDocumentSchema.safeParse(parsed.payload);
    if (!document.success) return context.json({ error: 'invalid_request' }, 422);
    const firstSegment = document.data.segments[0];
    if (firstSegment === undefined) return context.json({ error: 'invalid_request' }, 422);
    return context.json(
      documentBriefSchema.parse({
        document: document.data,
        items: [
          {
            citation: { segmentIds: [firstSegment.id] },
            kind: 'summary',
            severity: null,
            text: 'Review this source excerpt before taking any next step.',
          },
        ],
      }),
    );
  });

  application.post('/v1/comparisons/document', async (context) => {
    const parsed = await parseBoundedJson(context);
    if (hasResponse(parsed)) return parsed.response;
    const input = documentComparisonInputSchema.safeParse(parsed.payload);
    if (!input.success) return context.json({ error: 'invalid_request' }, 422);
    return context.json(
      documentComparisonSchema.parse(compareSegmentedDocuments(input.data.left, input.data.right)),
    );
  });

  application.post('/v1/dates/calculate', async (context) => {
    const parsed = await parseBoundedJson(context);
    if (hasResponse(parsed)) return parsed.response;
    const input = dateCalculationInputSchema.safeParse(parsed.payload);
    if (!input.success) return context.json({ error: 'invalid_request' }, 422);
    return context.json(dateCalculationResultSchema.parse(calculateConfirmedDate(input.data)));
  });

  application.post('/v1/questions/document', async (context) => {
    const parsed = await parseBoundedJson(context);
    if (hasResponse(parsed)) return parsed.response;
    const input = groundedQuestionInputSchema.safeParse(parsed.payload);
    if (!input.success) return context.json({ error: 'invalid_request' }, 422);
    return context.json(groundedAnswerSchema.parse(answerGroundedQuestion(input.data)));
  });

  application.get('/v1/sources/:topic', (context) => {
    const topic = officialSourceTopicSchema.safeParse(context.req.param('topic'));
    if (!topic.success) return context.json({ error: 'invalid_request' }, 422);
    return context.json({ sources: resolveOfficialSources(topic.data), topic: topic.data });
  });

  application.post('/v1/transcriptions', async (context) => {
    const parsed = await parseBoundedJson(context, MAX_TRANSCRIPTION_JSON_BYTES);
    if (hasResponse(parsed)) return parsed.response;
    const input = transcriptionRequestSchema.safeParse(parsed.payload);
    if (!input.success) return context.json({ error: 'invalid_request' }, 422);
    if (transcriber === undefined) return context.json({ error: 'transcription_unavailable' }, 503);
    try {
      return context.json(
        transcriptionReviewSchema.parse(await transcriber.transcribe(input.data)),
      );
    } catch {
      return context.json({ error: 'transcription_unavailable' }, 503);
    }
  });

  application.notFound((context) => context.json({ error: 'not_found' }, 404));

  application.onError((_error, context) => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      context.header(name, value);
    }

    return context.json({ error: 'internal_error' }, 500);
  });

  return application;
}

export const app = createApp();
