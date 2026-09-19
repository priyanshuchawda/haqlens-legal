const document = await Bun.file('docs/openapi.json').json();

const expectedPaths = [
  '/health',
  '/v1/briefs/document',
  '/v1/comparisons/document',
  '/v1/dates/calculate',
  '/v1/extractions/facts',
  '/v1/questions/document',
  '/v1/routes/prepare',
  '/v1/sources/{topic}',
  '/v1/transcriptions',
];

if (
  document.openapi !== '3.1.0' ||
  JSON.stringify(Object.keys(document.paths).sort()) !== JSON.stringify(expectedPaths)
) {
  throw new Error('OpenAPI contract does not match the bounded API surface.');
}

for (const path of expectedPaths.slice(1)) {
  const operation = document.paths[path]?.post ?? document.paths[path]?.get;
  if (operation?.responses?.['429'] === undefined) {
    throw new Error(`OpenAPI contract must document rate limiting for ${path}.`);
  }
}

const briefSchema =
  document.paths['/v1/briefs/document']?.post?.responses?.['200']?.content?.['application/json']
    ?.schema?.$ref;
if (briefSchema !== '#/components/schemas/DocumentBrief') {
  throw new Error('OpenAPI contract must describe a source-linked document brief response.');
}

const comparisonSchema =
  document.paths['/v1/comparisons/document']?.post?.responses?.['200']?.content?.[
    'application/json'
  ]?.schema?.$ref;
if (comparisonSchema !== '#/components/schemas/DocumentComparison') {
  throw new Error('OpenAPI contract must describe a source-aligned document comparison response.');
}

const dateSchema =
  document.paths['/v1/dates/calculate']?.post?.responses?.['200']?.content?.['application/json']
    ?.schema?.$ref;
if (dateSchema !== '#/components/schemas/DateCalculationResult') {
  throw new Error('OpenAPI contract must describe a confirmed-only date calculation response.');
}

const questionSchema =
  document.paths['/v1/questions/document']?.post?.responses?.['200']?.content?.['application/json']
    ?.schema?.$ref;
if (questionSchema !== '#/components/schemas/GroundedAnswer') {
  throw new Error('OpenAPI contract must describe a citation-bound grounded answer response.');
}

console.info('OpenAPI contract validation passed.');
