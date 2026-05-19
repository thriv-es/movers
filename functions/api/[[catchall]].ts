import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import type { Bindings } from './_lib/types';
import chat from './_routes/chat';
import analyze from './_routes/analyze';
import price from './_routes/price';
import images from './_routes/images';

const app = new Hono<{ Bindings: Bindings }>().basePath('/api');

app.route('/chat', chat);
app.route('/analyze', analyze);
app.route('/price', price);
app.route('/images', images);

export const onRequest = handle(app);
