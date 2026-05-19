import { Hono } from 'hono';
import type { Bindings } from '../_lib/types';

const images = new Hono<{ Bindings: Bindings }>();

images.post('/upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const imageFiles = formData.getAll('images');
    const uploadedUrls: string[] = [];

    if (!imageFiles || imageFiles.length === 0) {
      return c.json({ error: 'No images provided' }, 400);
    }

    for (const entry of imageFiles) {
      if (typeof entry !== 'string') {
        const file = entry as File;
        const key = `${crypto.randomUUID()}-${file.name}`;
        await c.env.MOVERS_BUCKET.put(key, file.stream(), {
          httpMetadata: { contentType: file.type },
        });
        const url = new URL(c.req.url);
        let host = c.req.header('host');
        if (host && host.startsWith('0.0.0.0')) {
          host = host.replace('0.0.0.0', 'localhost');
          if (!host.includes(':')) host = `${host}:${url.port || '8787'}`;
        }
        const origin = host ? `${url.protocol}//${host}` : url.origin;
        uploadedUrls.push(`${origin}/api/images/${key}`);
      }
    }

    return c.json(uploadedUrls);
  } catch (error) {
    console.error('Image upload error:', error);
    return c.json({ error: 'Failed to upload images' }, 500);
  }
});

images.get('/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.MOVERS_BUCKET.get(key);

  if (!object) return c.json({ error: 'Image not found' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);

  return new Response(object.body, { headers });
});

export default images;
