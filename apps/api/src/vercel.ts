import { createGeminiExtractor, createGeminiTranscriber } from '@haqlens/ai-gemini';

import { createApp } from './app';

const apiKey = process.env.GEMINI_API_KEY;

export const app =
  process.env.AI_PROVIDER === 'gemini' && apiKey !== undefined
    ? createApp({
        extractionSource: 'gemini',
        factExtractor: createGeminiExtractor({ apiKey }),
        transcriber: createGeminiTranscriber({ apiKey }),
      })
    : createApp();
