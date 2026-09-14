import { createGeminiExtractor } from '@h2s/ai-gemini';

import { createApp, MAX_JSON_BYTES } from './app';
import { loadRuntimeConfig } from './config';

const config = loadRuntimeConfig(process.env);
const app =
  config.AI_PROVIDER === 'gemini' && config.GEMINI_API_KEY !== undefined
    ? createApp({
        extractionSource: 'gemini',
        factExtractor: createGeminiExtractor({ apiKey: config.GEMINI_API_KEY }),
      })
    : createApp();

Bun.serve({
  fetch(request, server) {
    const clientKey = server.requestIP(request)?.address ?? 'unknown-peer';
    return app.fetch(request, { clientKey });
  },
  maxRequestBodySize: MAX_JSON_BYTES,
  port: config.PORT,
});

console.info(`API listening on port ${config.PORT}.`);
