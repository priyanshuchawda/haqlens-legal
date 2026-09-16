import { describe, expect, test } from 'bun:test';

import { MAX_SEGMENT_CHARS } from '@h2s/contracts';

import { compareSegmentedDocuments, segmentTextDocument } from './index';

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
