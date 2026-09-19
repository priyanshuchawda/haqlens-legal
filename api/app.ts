import { createGeminiExtractor, createGeminiTranscriber } from '@haqlens/ai-gemini';

import { createApp } from '../apps/api/src/app.js';

const environment = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;
const apiKey = environment?.GEMINI_API_KEY;

export const app =
  environment?.AI_PROVIDER === 'gemini' && apiKey !== undefined
    ? createApp({
        extractionSource: 'gemini',
        factExtractor: createGeminiExtractor({ apiKey }),
        transcriber: createGeminiTranscriber({ apiKey }),
      })
    : createApp();
