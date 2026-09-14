const secretPatterns: ReadonlyArray<readonly [label: string, expression: RegExp]> = [
  ['Google API key', /AIza[0-9A-Za-z_-]{20,}/u],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9_]{20,}/u],
  ['private key block', /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/u],
];

const listedFiles = Bun.spawnSync(
  ['git', 'ls-files', '--cached', '--others', '--exclude-standard'],
  {
    cwd: import.meta.dir + '/..',
    stdout: 'pipe',
  },
);

if (listedFiles.exitCode !== 0) {
  throw new Error('Unable to list repository files for secret scanning.');
}

const root = import.meta.dir + '/..';
const paths = new TextDecoder().decode(listedFiles.stdout).split('\n').filter(Boolean);
const findings: string[] = [];

for (const path of paths) {
  const file = Bun.file(`${root}/${path}`);
  const content = await file.text();

  if (content.includes('\0')) {
    continue;
  }

  for (const [label, expression] of secretPatterns) {
    if (expression.test(content)) {
      findings.push(`${path}: ${label}`);
    }
  }
}

if (findings.length > 0) {
  console.error(`Secret scan failed:\n${findings.join('\n')}`);
  process.exit(1);
}

console.info(`Secret scan passed for ${paths.length} tracked or unignored files.`);
