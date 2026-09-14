import { app } from './app';
import { loadRuntimeConfig } from './config';

const config = loadRuntimeConfig(process.env);

Bun.serve({
  fetch: app.fetch,
  port: config.PORT,
});

console.info(`API listening on port ${config.PORT}.`);
