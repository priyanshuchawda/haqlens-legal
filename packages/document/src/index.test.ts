import { describe, expect, test } from 'bun:test';

import { MAX_SEGMENT_CHARS } from '@h2s/contracts';

import {
  classifyUpload,
  compareSegmentedDocuments,
  MAX_UPLOAD_BYTES,
  redactDirectIdentifiers,
  segmentTextDocument,
} from './index';

describe('text document segmentation', () => {
  test('normalises line endings and assigns stable, source-exact paragraph citations', () => {
    const document = segmentTextDocument({
      sourceLabel: 'Offer letter',
      text: '  First clause.\r\n\r\nSecond clause.\rThird clause.  ',
    });

    expect(document.text).toBe('First clause.\n\nSecond clause.\nThird clause.');
    expect(document.segments).toEqual([
      {
        id: 'segment-1',
        page: null,
        sourceEnd: 13,
        sourceStart: 0,
        text: 'First clause.',
      },
      {
        id: 'segment-2',
        page: null,
        sourceEnd: 43,
        sourceStart: 15,
        text: 'Second clause.\nThird clause.',
      },
    ]);
    for (const segment of document.segments) {
      expect(document.text.slice(segment.sourceStart, segment.sourceEnd)).toBe(segment.text);
    }
  });

  test('splits long paragraphs into bounded, contiguous source ranges', () => {
    const text = 'x'.repeat(MAX_SEGMENT_CHARS + 1);
    const document = segmentTextDocument({ sourceLabel: 'Notice', text });

    expect(document.segments).toHaveLength(2);
    expect(document.segments.map((segment) => segment.text).join('')).toBe(text);
    expect(document.segments[0]?.sourceEnd).toBe(document.segments[1]?.sourceStart);
  });

  test('fails closed on control characters, empty paragraphs, and excessive segments', () => {
    expect(() => segmentTextDocument({ sourceLabel: 'Notice', text: 'unsafe\u0000text' })).toThrow(
      RangeError,
    );
    expect(() => segmentTextDocument({ sourceLabel: 'Notice', text: '   \n\n  ' })).toThrow();
    expect(() =>
      segmentTextDocument({
        sourceLabel: 'Notice',
        text: Array.from({ length: 251 }, (_, index) => `Clause ${index + 1}`).join('\n\n'),
      }),
    ).toThrow(RangeError);
  });
});

describe('deterministic document comparison', () => {
  test('uses normalized exact matches to anchor changed, removed, and added clauses', () => {
    const left = segmentTextDocument({
      sourceLabel: 'Earlier agreement',
      text: 'Unchanged clause.\n\nOld payment clause.\n\nRemoved clause.',
    });
    const right = segmentTextDocument({
      sourceLabel: 'Revised agreement',
      text: '  unchanged   clause.\n\nNew payment clause.\n\nAdded clause.',
    });

    expect(compareSegmentedDocuments(left, right).changes).toEqual([
      {
        kind: 'changed',
        leftSegmentIds: ['segment-2'],
        rightSegmentIds: ['segment-2'],
      },
      {
        kind: 'changed',
        leftSegmentIds: ['segment-3'],
        rightSegmentIds: ['segment-3'],
      },
    ]);
  });

  test('reports unpaired clauses as source-scoped additions or removals', () => {
    const left = segmentTextDocument({ sourceLabel: 'Earlier', text: 'Shared.\n\nRemoved.' });
    const right = segmentTextDocument({
      sourceLabel: 'Revised',
      text: 'Shared.\n\nAdded.\n\nAlso added.',
    });

    expect(compareSegmentedDocuments(left, right).changes).toEqual([
      {
        kind: 'changed',
        leftSegmentIds: ['segment-2'],
        rightSegmentIds: ['segment-2'],
      },
      { kind: 'added', leftSegmentIds: null, rightSegmentIds: ['segment-3'] },
    ]);
  });

  test('returns no changes when every segment matches after whitespace and case normalization', () => {
    const left = segmentTextDocument({ sourceLabel: 'Earlier', text: 'Shared clause.' });
    const right = segmentTextDocument({ sourceLabel: 'Revised', text: ' shared   CLAUSE. ' });

    expect(compareSegmentedDocuments(left, right).changes).toEqual([]);
  });
});

describe('local direct-identifier redaction', () => {
  test('redacts common identifiers deterministically without network access', () => {
    expect(
      redactDirectIdentifiers(
        'Email a@b.in, call +91 98765 43210, Aadhaar 1234 5678 9012, PAN ABCDE1234F.',
      ),
    ).toEqual({
      counts: { email: 1, government_id: 1, phone: 1, tax_id: 1 },
      text: 'Email [REDACTED EMAIL], call [REDACTED PHONE], Aadhaar [REDACTED GOVERNMENT ID], PAN [REDACTED TAX ID].',
    });
  });

  test('rejects unsafe control characters instead of silently exporting them', () => {
    expect(() => redactDirectIdentifiers('unsafe\u0000text')).toThrow(RangeError);
  });
});

describe('secure file-intake classification', () => {
  test('accepts only declared allow-list types with matching magic bytes', () => {
    expect(
      classifyUpload('application/pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])),
    ).toEqual({ accepted: true, kind: 'pdf' });
    expect(
      classifyUpload('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toEqual({ accepted: true, kind: 'png' });
    expect(classifyUpload('text/plain', new TextEncoder().encode('Plain evidence.'))).toEqual({
      accepted: true,
      kind: 'text',
    });
  });

  test('rejects spoofed, unsupported, malformed, and oversized files before extraction', () => {
    expect(classifyUpload('application/pdf', new TextEncoder().encode('not a PDF'))).toEqual({
      accepted: false,
      reason: 'invalid_signature',
    });
    expect(classifyUpload('application/zip', new Uint8Array([0x50, 0x4b, 3, 4]))).toEqual({
      accepted: false,
      reason: 'declared_type_mismatch',
    });
    expect(classifyUpload('text/plain', new Uint8Array([0xff]))).toEqual({
      accepted: false,
      reason: 'invalid_signature',
    });
    expect(classifyUpload('image/jpeg', new Uint8Array(MAX_UPLOAD_BYTES + 1))).toEqual({
      accepted: false,
      reason: 'payload_too_large',
    });
  });
});
