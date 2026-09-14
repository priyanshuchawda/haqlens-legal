const directory = `${import.meta.dir}/../apps/web/dist`;
const bundle = Bun.spawnSync(['find', directory, '-type', 'f', '-name', '*.js'], {
  stdout: 'pipe',
});

if (bundle.exitCode !== 0) {
  throw new Error('Web build output is missing; run the web build before scanning the bundle.');
}

const files = new TextDecoder().decode(bundle.stdout).split('\n').filter(Boolean);
const keyPattern = /AIza[0-9A-Za-z_-]{20,}/u;

for (const path of files) {
  if (keyPattern.test(await Bun.file(path).text())) {
    console.error(`Client bundle secret scan failed: ${path}`);
    process.exit(1);
  }
}

console.info(`Client bundle secret scan passed for ${files.length} JavaScript assets.`);
