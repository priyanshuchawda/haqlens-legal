import { describe, expect, test } from 'bun:test';

import {
  createFixtureExtractor,
  createGeminiExtractor,
  createGeminiTranscriber,
  type ExtractionFailure,
  type ExtractionRequest,
  type ExtractionResult,
} from './index';

const request = {
  evidence: [
    {
      id: 'evidence-1',
      kind: 'document_quote' as const,
      sourceLabel: 'Synthetic termination email',
      page: null,
      excerpt: 'Employment ends on 2026-02-10.',
    },
  ],
} satisfies ExtractionRequest;

const validExtraction = {
  facts: [
    {
      key: 'event_date',
      value: '2026-02-10',
      certainty: 'confirmed',
      evidenceIds: ['evidence-1'],
    },
  ],
} satisfies ExtractionResult;

function providerResponse(text: string): Response {
  return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
}

describe('Gemini extraction adapter', () => {
  test.each([
    { apiKey: ' ' },
    { apiKey: 'test-key', model: '' },
    { apiKey: 'test-key', model: 'gemini/unsafe' },
    { apiKey: 'test-key', timeoutMs: 0 },
    { apiKey: 'test-key', timeoutMs: 60_001 },
  ])('rejects invalid configuration %#', (options) => {
    expect(() => createGeminiExtractor(options)).toThrow(RangeError);
  });

  test('sends an injection-resistant structured extraction request and validates its response', async () => {
    let captured: RequestInit | undefined;
    const extractor = createGeminiExtractor({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        captured = init;
        return providerResponse(JSON.stringify(validExtraction));
      },
    });

    await expect(extractor.extract(request)).resolves.toEqual(validExtraction);
    const payload = JSON.parse(String(captured?.body)) as {
      systemInstruction: { parts: Array<{ text: string }> };
      generationConfig: {
        responseMimeType: string;
        responseSchema: { type: string };
      };
    };

    expect(captured?.headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
    expect(payload.systemInstruction.parts[0]?.text).toContain('untrusted data');
    expect(payload.generationConfig.responseMimeType).toBe('application/json');
    expect(payload.generationConfig.responseSchema.type).toBe('OBJECT');
  });

  const failureCases: ReadonlyArray<
    readonly [string, () => Promise<Response>, ExtractionFailure['code']]
  > = [
    [
      'provider status failure',
      async () => new Response('', { status: 503 }),
      'provider_unavailable',
    ],
    [
      'malformed provider payload',
      async () => new Response('not-json'),
      'invalid_provider_response',
    ],
    [
      'oversized provider payload',
      async () => new Response('x'.repeat(256 * 1024 + 1)),
      'invalid_provider_response',
    ],
    ['malformed model JSON', async () => providerResponse('{'), 'invalid_model_output'],
    [
      'unknown output field',
      async () =>
        providerResponse(JSON.stringify({ ...validExtraction, legalAdvice: 'do this now' })),
      'invalid_model_output',
    ],
    [
      'orphaned evidence ID',
      async () =>
        providerResponse(
          JSON.stringify({
            facts: [{ ...validExtraction.facts[0], evidenceIds: ['unknown-evidence'] }],
          }),
        ),
      'invalid_model_output',
    ],
  ];

  test.each(failureCases)('fails closed on %s', async (_label, fetch, code) => {
    const extractor = createGeminiExtractor({ apiKey: 'test-key', fetch });

    await expect(extractor.extract(request)).rejects.toMatchObject({
      code,
    } satisfies Partial<ExtractionFailure>);
  });

  test('maps an abort to timeout without surfacing transport details', async () => {
    const extractor = createGeminiExtractor({
      apiKey: 'test-key',
      timeoutMs: 1,
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('network internals')));
        }),
    });

    await expect(extractor.extract(request)).rejects.toMatchObject({
      code: 'timeout',
    } satisfies Partial<ExtractionFailure>);
  });

  test('uses deterministic fixtures without a network or credential', async () => {
    const extractor = createFixtureExtractor(validExtraction);

    await expect(extractor.extract(request)).resolves.toEqual(validExtraction);
  });
});

describe('Gemini transcription adapter', () => {
  const transcription = {
    sourceLabel: 'Scan',
    mimeType: 'image/png' as const,
    dataBase64: 'c2Nhbi1ieXRlcw==',
  };

  test('uses strict structured multimodal output and keeps transcription unconfirmed', async () => {
    let captured: RequestInit | undefined;
    const transcriber = createGeminiTranscriber({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        captured = init;
        return providerResponse(
          JSON.stringify({ pages: [{ page: 1, confidence: 0.8, text: 'Scan text.' }] }),
        );
      },
    });
    await expect(transcriber.transcribe(transcription)).resolves.toEqual({
      confirmed: false,
      sourceLabel: 'Scan',
      pages: [{ page: 1, confidence: 0.8, text: 'Scan text.' }],
    });
    const body = JSON.parse(String(captured?.body)) as {
      contents: Array<{ parts: Array<{ inlineData: { mimeType: string } }> }>;
    };
    expect(body.contents[0]?.parts[0]?.inlineData.mimeType).toBe('image/png');
  });

  test('fails closed for unsafe input and malformed provider output', async () => {
    const transcriber = createGeminiTranscriber({
      apiKey: 'test-key',
      fetch: async () => providerResponse(JSON.stringify({ pages: [] })),
    });
    await expect(
      transcriber.transcribe({ ...transcription, mimeType: 'text/plain' as never }),
    ).rejects.toMatchObject({ code: 'invalid_model_output' });
    await expect(transcriber.transcribe(transcription)).rejects.toMatchObject({
      code: 'invalid_model_output',
    });
  });
});
