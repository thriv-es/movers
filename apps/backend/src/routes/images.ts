import { Hono } from 'hono';
import type { Bindings } from '../types';

const images = new Hono<{ Bindings: Bindings }>();

// POST /upload - Upload images to R2
images.post('/upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const imageFiles = formData.getAll('images');
    const uploadedUrls: string[] = [];

    if (!imageFiles || imageFiles.length === 0) {
      return c.json({ error: 'No images provided' }, 400);
    }

    for (const entry of imageFiles) {
      if (entry instanceof File) {
        const key = `${crypto.randomUUID()}-${entry.name}`;
        await c.env.MOVERS_BUCKET.put(key, entry.stream(), {
          httpMetadata: {
            contentType: entry.type,
          },
        });
        const url = new URL(c.req.url);
        // Use the host header if available to construct the URL
        let host = c.req.header('host');
        // Fix for local development where host might be 0.0.0.0
        if (host && host.startsWith('0.0.0.0')) {
          host = host.replace('0.0.0.0', 'localhost');
          if (!host.includes(':')) {
            host = `${host}:${url.port || '8787'}`;
          }
        }
        const protocol = url.protocol;
        const origin = host ? `${protocol}//${host}` : url.origin;
        
        uploadedUrls.push(`${origin}/api/images/${key}`);
      }
    }

    return c.json(uploadedUrls);
  } catch (error) {
    console.error('Image upload error:', error);
    return c.json({ error: 'Failed to upload images' }, 500);
  }
});

// GET /:key - Get image from R2
images.get('/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.MOVERS_BUCKET.get(key);

  if (!object) {
    return c.json({ error: 'Image not found' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);

  return new Response(object.body, {
    headers,
  });
});

export default images;
