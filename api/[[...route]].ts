import { handle } from 'hono/vercel';

import { createApp } from '../apps/api/src/app.js';

const app = createApp();

export default handle(app);
