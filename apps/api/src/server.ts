import { app, MAX_JSON_BYTES } from './app';
import { loadRuntimeConfig } from './config';

const config = loadRuntimeConfig(process.env);

Bun.serve({
  fetch: app.fetch,
  maxRequestBodySize: MAX_JSON_BYTES,
  port: config.PORT,
});

console.info(`API listening on port ${config.PORT}.`);
