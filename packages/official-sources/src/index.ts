import {
  officialSourceSchema,
  officialSourceTopicSchema,
  type OfficialSource,
  type OfficialSourceTopic,
} from '@h2s/contracts';

const allowedHosts = new Set(['consumerhelpline.gov.in', 'nalsa.gov.in', 'samadhan.labour.gov.in']);

const manifest: readonly OfficialSource[] = [
  {
    authority: 'National Legal Services Authority',
    id: 'official-nalsa-legal-aid',
    reviewedOn: '2026-09-17',
    title: 'Legal Aid',
    topics: ['legal_aid'],
    url: 'https://nalsa.gov.in/legal-aid/',
  },
  {
    authority: 'Ministry of Labour and Employment',
    id: 'official-samadhan-employment',
    reviewedOn: '2026-09-17',
    title: 'SAMADHAN employment grievance portal',
    topics: ['employment_dispute'],
    url: 'https://samadhan.labour.gov.in/',
  },
  {
    authority: 'Department of Consumer Affairs',
    id: 'official-national-consumer-helpline',
    reviewedOn: '2026-09-17',
    title: 'National Consumer Helpline',
    topics: ['consumer_dispute'],
    url: 'https://consumerhelpline.gov.in/public/',
  },
];

function validateOfficialSource(source: OfficialSource): OfficialSource {
  const parsed = officialSourceSchema.parse(source);
  const url = new URL(parsed.url);

  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
    throw new RangeError('Official source URL is not on an approved HTTPS host.');
  }

  return Object.freeze(parsed);
}

export const officialSourceManifest = Object.freeze(manifest.map(validateOfficialSource));

/** Resolves only generic, validated topics against the reviewed local manifest. */
export function resolveOfficialSources(topic: OfficialSourceTopic): readonly OfficialSource[] {
  const parsedTopic = officialSourceTopicSchema.parse(topic);
  return officialSourceManifest.filter((source) => source.topics.includes(parsedTopic));
}
