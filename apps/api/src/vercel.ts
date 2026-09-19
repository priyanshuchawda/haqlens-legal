import { createGeminiExtractor, createGeminiTranscriber } from '@haqlens/ai-gemini';

import { createApp } from './app';

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL;

export const app =
  process.env.AI_PROVIDER === 'gemini' && apiKey !== undefined
    ? createApp({
        extractionSource: 'gemini',
        factExtractor: createGeminiExtractor({ apiKey, ...(model ? { model } : {}) }),
        transcriber: createGeminiTranscriber({ apiKey, ...(model ? { model } : {}) }),
      })
    : createApp();
