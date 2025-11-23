import { Hono } from 'hono';
import { poweredBy } from 'hono/powered-by';

// Bindings
export type Bindings = {
  DB: D1Database;
  KV: KVNamespace;
  BUCKET: R2Bucket;
  QUEUE: Queue;
  ENV: 'development' | 'production';
};

const app = new Hono<{ Bindings: Bindings }>();

// Middleware
app.use('*', poweredBy());

// Routes
app.get('/', (c) => {
  return c.json({
    message: 'Hello, World!',
    env: c.env.ENV,
  });
});

export default app;