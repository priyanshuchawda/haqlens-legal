import { Hono } from 'hono';

const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
} as const;

export const app = new Hono();

app.use('*', async (context, next) => {
  await next();

  for (const [name, value] of Object.entries(securityHeaders)) {
    context.header(name, value);
  }
});

app.get('/health', (context) => context.json({ status: 'ok' }));

app.notFound((context) => context.json({ error: 'not_found' }, 404));

app.onError(() => new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 }));
