import { handle } from 'hono/vercel';

import { createApp } from './app.js';

const app = createApp();
export const config = { runtime: 'edge' };
const honoHandler = handle(app);

export default (request: Request) => {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  return honoHandler(new Request(url, request));
};
