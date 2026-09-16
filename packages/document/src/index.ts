import {
  documentTextInputSchema,
  MAX_DOCUMENT_SEGMENTS,
  MAX_SEGMENT_CHARS,
  segmentedDocumentSchema,
  type DocumentTextInput,
} from '@h2s/contracts';

function normaliseText(value: string): string {
  const text = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  const hasUnsafeControlCharacter = [...text].some((character) => {
    const code = character.charCodeAt(0);
    return code === 127 || (code < 32 && code !== 9 && code !== 10);
  });

  if (hasUnsafeControlCharacter) {
    throw new RangeError('Document text contains unsafe control characters.');
  }

  return text;
}

function paragraphRanges(text: string): Array<Readonly<{ end: number; start: number }>> {
  const ranges: Array<Readonly<{ end: number; start: number }>> = [];
  const expression = /\S(?:[\s\S]*?\S)?(?=\n[\t ]*\n|$)/gu;

  for (const match of text.matchAll(expression)) {
    const start = match.index;
    const value = match[0];
    if (start === undefined || value === undefined) continue;
    ranges.push({ end: start + value.length, start });
  }

  return ranges;
}

function splitRange(
  range: Readonly<{ end: number; start: number }>,
): Array<Readonly<{ end: number; start: number }>> {
  const chunks: Array<Readonly<{ end: number; start: number }>> = [];

  for (let start = range.start; start < range.end; start += MAX_SEGMENT_CHARS) {
    chunks.push({ end: Math.min(start + MAX_SEGMENT_CHARS, range.end), start });
  }

  return chunks;
}

/** Turns bounded, untrusted text into stable citation targets without interpretation. */
export function segmentTextDocument(input: DocumentTextInput) {
  const parsed = documentTextInputSchema.parse(input);
  const text = normaliseText(parsed.text);
  const ranges = paragraphRanges(text).flatMap(splitRange);

  if (ranges.length === 0 || ranges.length > MAX_DOCUMENT_SEGMENTS) {
    throw new RangeError('Document text cannot be represented within the segment limit.');
  }

  return segmentedDocumentSchema.parse({
    sourceLabel: parsed.sourceLabel,
    text,
    segments: ranges.map((range, index) => ({
      id: `segment-${index + 1}`,
      page: null,
      sourceEnd: range.end,
      sourceStart: range.start,
      text: text.slice(range.start, range.end),
    })),
  });
}
