import { Hono } from 'hono';
import { poweredBy } from 'hono/powered-by';
import { cors } from 'hono/cors';
import type { Bindings } from './types';
import { chatRoutes, analyzeRoutes, priceRoutes, imagesRoutes } from './routes';

// Re-export Bindings for backwards compatibility
export type { Bindings } from './types';

const app = new Hono<{ Bindings: Bindings }>();

// Middleware
app.use('*', poweredBy());
app.use('*', cors());

// Health check
app.get('/', (c) => {
  return c.json({
    message: 'Hello, World!',
    env: c.env.ENV,
  });
});

// Mount routes
app.route('/api/chat', chatRoutes);
app.route('/api/analyze', analyzeRoutes);
app.route('/api/price', priceRoutes);
app.route('/api/images', imagesRoutes);

export default app;
