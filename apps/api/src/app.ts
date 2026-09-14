import {
  caseInputSchema,
  routeDecisionSchema,
  type CaseInput,
  type RouteDecision,
} from '@h2s/contracts';
import { routeCase } from '@h2s/core';
import { Hono } from 'hono';

export const MAX_JSON_BYTES = 64 * 1024;

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
  route?: Route;
}>;

export function createApp({ route = routeCase }: AppDependencies = {}) {
  const application = new Hono();

  application.use('*', async (context, next) => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      context.header(name, value);
    }

    await next();
  });

  application.get('/health', (context) => context.json({ status: 'ok' }));

  application.post('/v1/routes/prepare', async (context) => {
    const contentType = context.req.header('content-type')?.toLocaleLowerCase('en-US');

    if (contentType?.startsWith('application/json') !== true) {
      return context.json({ error: 'unsupported_media_type' }, 415);
    }

    const contentLength = Number(context.req.header('content-length'));

    if (Number.isSafeInteger(contentLength) && contentLength > MAX_JSON_BYTES) {
      return context.json({ error: 'payload_too_large' }, 413);
    }

    const body = await context.req.raw.text();

    if (new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
      return context.json({ error: 'payload_too_large' }, 413);
    }

    let payload: unknown;

    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }

    const input = caseInputSchema.safeParse(payload);

    if (!input.success) {
      return context.json({ error: 'invalid_request' }, 422);
    }

    return context.json(routeDecisionSchema.parse(route(input.data)));
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
