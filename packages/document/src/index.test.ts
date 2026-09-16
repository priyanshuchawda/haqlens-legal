import { describe, expect, test } from 'bun:test';

import { MAX_SEGMENT_CHARS } from '@h2s/contracts';

import { segmentTextDocument } from './index';

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
