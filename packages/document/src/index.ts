import {
  documentTextInputSchema,
  documentComparisonSchema,
  MAX_DOCUMENT_SEGMENTS,
  MAX_SEGMENT_CHARS,
  segmentedDocumentSchema,
  transcriptionReviewSchema,
  type SegmentedDocument,
  type DocumentTextInput,
  type TranscriptionReview,
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

/** Makes OCR/transcription usable only after explicit user confirmation, preserving page order. */
export function confirmedTranscriptionText(review: TranscriptionReview | unknown): string | null {
  const parsed = transcriptionReviewSchema.parse(review);
  if (!parsed.confirmed) return null;
  return parsed.pages
    .toSorted((left, right) => left.page - right.page)
    .map((page) => page.text)
    .join('\n\n');
}

export type RedactionKind = 'email' | 'phone' | 'government_id' | 'tax_id';
export type RedactionPreview = Readonly<{
  counts: Readonly<Record<RedactionKind, number>>;
  text: string;
}>;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export type AcceptedFileKind = 'pdf' | 'png' | 'jpeg' | 'webp' | 'text';
export type FileIntakeResult = Readonly<
  | { accepted: true; kind: AcceptedFileKind }
  | {
      accepted: false;
      reason: 'declared_type_mismatch' | 'invalid_signature' | 'payload_too_large';
    }
>;

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

/** Classifies only a small allow-list by both declared MIME type and magic bytes. */
export function classifyUpload(declaredType: string, bytes: Uint8Array): FileIntakeResult {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { accepted: false, reason: 'payload_too_large' };
  const type = declaredType.trim().toLocaleLowerCase('en-US');
  const signatures: ReadonlyArray<
    Readonly<{ kind: AcceptedFileKind; type: string; valid: boolean }>
  > = [
    {
      kind: 'pdf',
      type: 'application/pdf',
      valid: startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]),
    },
    {
      kind: 'png',
      type: 'image/png',
      valid: startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    },
    { kind: 'jpeg', type: 'image/jpeg', valid: startsWith(bytes, [0xff, 0xd8, 0xff]) },
    {
      kind: 'webp',
      type: 'image/webp',
      valid:
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50,
    },
  ];
  const signature = signatures.find((item) => item.type === type);
  if (signature !== undefined) {
    return signature.valid
      ? { accepted: true, kind: signature.kind }
      : { accepted: false, reason: 'invalid_signature' };
  }
  if (type !== 'text/plain') return { accepted: false, reason: 'declared_type_mismatch' };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    normaliseText(decoder.decode(bytes));
    return { accepted: true, kind: 'text' };
  } catch {
    return { accepted: false, reason: 'invalid_signature' };
  }
}

const redactionPatterns: ReadonlyArray<Readonly<{ kind: RedactionKind; pattern: RegExp }>> = [
  { kind: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/giu },
  { kind: 'phone', pattern: /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/gu },
  { kind: 'government_id', pattern: /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/gu },
  { kind: 'tax_id', pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/gu },
];

/** Redacts common direct identifiers locally; callers must still let the user review the result. */
export function redactDirectIdentifiers(value: string): RedactionPreview {
  const text = normaliseText(value);
  const counts: Record<RedactionKind, number> = { email: 0, phone: 0, government_id: 0, tax_id: 0 };
  let redacted = text;
  for (const { kind, pattern } of redactionPatterns) {
    redacted = redacted.replace(pattern, () => {
      counts[kind] += 1;
      return `[REDACTED ${kind.replaceAll('_', ' ').toUpperCase()}]`;
    });
  }
  return Object.freeze({ counts: Object.freeze(counts), text: redacted });
}

function comparisonKey(text: string): string {
  return text.replaceAll(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

function longestCommonSubsequence(
  left: readonly string[],
  right: readonly string[],
): Array<Readonly<{ leftIndex: number; rightIndex: number }>> {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const lengths = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

  for (let leftIndex = 1; leftIndex < rows; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex < columns; rightIndex += 1) {
      const previous = lengths[leftIndex - 1]?.[rightIndex - 1] ?? 0;
      const above = lengths[leftIndex - 1]?.[rightIndex] ?? 0;
      const before = lengths[leftIndex]?.[rightIndex - 1] ?? 0;
      lengths[leftIndex]![rightIndex] =
        left[leftIndex - 1] === right[rightIndex - 1] ? previous + 1 : Math.max(above, before);
    }
  }

  const matches: Array<Readonly<{ leftIndex: number; rightIndex: number }>> = [];
  let leftIndex = left.length;
  let rightIndex = right.length;
  while (leftIndex > 0 && rightIndex > 0) {
    if (left[leftIndex - 1] === right[rightIndex - 1]) {
      matches.push({ leftIndex: leftIndex - 1, rightIndex: rightIndex - 1 });
      leftIndex -= 1;
      rightIndex -= 1;
      continue;
    }
    const above = lengths[leftIndex - 1]?.[rightIndex] ?? 0;
    const before = lengths[leftIndex]?.[rightIndex - 1] ?? 0;
    if (above >= before) leftIndex -= 1;
    else rightIndex -= 1;
  }

  return matches.reverse();
}

/**
 * Compares bounded segment sequences without interpretation. Exact normalized matches anchor the
 * alignment; unmatched neighbouring clauses become source-linked additions, removals, or changes.
 */
export function compareSegmentedDocuments(left: SegmentedDocument, right: SegmentedDocument) {
  const leftKeys = left.segments.map((segment) => comparisonKey(segment.text));
  const rightKeys = right.segments.map((segment) => comparisonKey(segment.text));
  const matches = longestCommonSubsequence(leftKeys, rightKeys);
  const changes: Array<{
    kind: 'added' | 'removed' | 'changed';
    leftSegmentIds: string[] | null;
    rightSegmentIds: string[] | null;
  }> = [];
  let leftCursor = 0;
  let rightCursor = 0;

  for (const match of [
    ...matches,
    { leftIndex: left.segments.length, rightIndex: right.segments.length },
  ]) {
    const unmatchedLeft = left.segments.slice(leftCursor, match.leftIndex);
    const unmatchedRight = right.segments.slice(rightCursor, match.rightIndex);
    const paired = Math.min(unmatchedLeft.length, unmatchedRight.length);
    for (let index = 0; index < paired; index += 1) {
      const leftSegment = unmatchedLeft[index];
      const rightSegment = unmatchedRight[index];
      if (leftSegment === undefined || rightSegment === undefined) continue;
      changes.push({
        kind: 'changed',
        leftSegmentIds: [leftSegment.id],
        rightSegmentIds: [rightSegment.id],
      });
    }
    for (const segment of unmatchedLeft.slice(paired)) {
      changes.push({ kind: 'removed', leftSegmentIds: [segment.id], rightSegmentIds: null });
    }
    for (const segment of unmatchedRight.slice(paired)) {
      changes.push({ kind: 'added', leftSegmentIds: null, rightSegmentIds: [segment.id] });
    }
    leftCursor = match.leftIndex + 1;
    rightCursor = match.rightIndex + 1;
  }

  return documentComparisonSchema.parse({ changes, left, right });
}
