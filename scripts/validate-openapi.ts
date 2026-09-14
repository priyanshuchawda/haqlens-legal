const document = await Bun.file('docs/openapi.json').json();

const expectedPaths = ['/health', '/v1/extractions/facts', '/v1/routes/prepare'];

if (
  document.openapi !== '3.1.0' ||
  JSON.stringify(Object.keys(document.paths).sort()) !== JSON.stringify(expectedPaths)
) {
  throw new Error('OpenAPI contract does not match the bounded API surface.');
}

for (const path of expectedPaths.slice(1)) {
  if (document.paths[path]?.post?.responses?.['429'] === undefined) {
    throw new Error(`OpenAPI contract must document rate limiting for ${path}.`);
  }
}

console.info('OpenAPI contract validation passed.');
