import { createGeminiExtractor, createGeminiTranscriber } from '@haqlens/ai-gemini';

import { createApp, MAX_JSON_BYTES } from './app';
import { clientKeyFromDirectPeer } from './client-key';
import { loadRuntimeConfig } from './config';

const config = loadRuntimeConfig(process.env);
const app =
  config.AI_PROVIDER === 'gemini' && config.GEMINI_API_KEY !== undefined
    ? createApp({
        extractionSource: 'gemini',
        factExtractor: createGeminiExtractor({ apiKey: config.GEMINI_API_KEY }),
        transcriber: createGeminiTranscriber({ apiKey: config.GEMINI_API_KEY }),
      })
    : createApp();

Bun.serve({
  fetch(request, server) {
    const clientKey = clientKeyFromDirectPeer(request, server.requestIP.bind(server));
    return app.fetch(request, { clientKey });
  },
  maxRequestBodySize: MAX_JSON_BYTES,
  port: config.PORT,
});

console.info(`API listening on port ${config.PORT}.`);
