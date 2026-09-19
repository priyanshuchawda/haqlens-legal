import { describe, expect, test } from 'bun:test';

import { officialSourceManifest, resolveOfficialSources } from './index';

describe('reviewed official-source manifest', () => {
  test('exposes only approved HTTPS official sources with review provenance', () => {
    expect(officialSourceManifest).toHaveLength(4);
    for (const source of officialSourceManifest) {
      expect(new URL(source.url).protocol).toBe('https:');
      expect(source.reviewedOn).toBe('2026-09-17');
    }
  });

  test('resolves generic topics deterministically without document input', () => {
    expect(resolveOfficialSources('employment_dispute')).toEqual([
      expect.objectContaining({ id: 'official-samadhan-employment' }),
    ]);
    expect(resolveOfficialSources('public_grievance')).toEqual([
      expect.objectContaining({ id: 'official-cpgrams-public-grievance' }),
    ]);
  });
});
