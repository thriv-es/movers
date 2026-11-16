import { Hono } from 'hono'
import { issuePhotoReceipt } from '../_lib/photo-receipts'
import type { Bindings } from '../_lib/types'

const images = new Hono<{ Bindings: Bindings }>()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

images.post('/upload', async (c) => {
  if (!c.env.MOVERS_DB) return c.json({ error: 'Photo uploads are temporarily unavailable' }, 503)
  const uploadedKeys: string[] = []
  try {
    const formData = await c.req.formData()
    const sessionId = formData.get('sessionId')
    const imageFiles = formData.getAll('images') as unknown as (File | string)[]
    if (typeof sessionId !== 'string' || !UUID.test(sessionId)) {
      return c.json({ error: 'Invalid estimate session' }, 400)
    }
    if (
      imageFiles.length === 0 ||
      imageFiles.length > 10 ||
      imageFiles.some(
        (entry) =>
          !(entry instanceof File) || !IMAGE_TYPES.has(entry.type) || entry.size === 0 || entry.size > MAX_IMAGE_BYTES,
      )
    ) {
      return c.json({ error: 'Provide 1–10 JPEG, PNG or WebP images under 10 MB each' }, 400)
    }

    await c.env.MOVERS_DB.prepare('DELETE FROM photo_receipts WHERE expires_at <= ?')
      .bind(new Date().toISOString())
      .run()
    const uploads: { url: string; receipt: string }[] = []
    for (const entry of imageFiles) {
      const file = entry as File
      const key = `${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, '_').slice(0, 120) || 'photo'}`
      const receipt = await issuePhotoReceipt(c.env.MOVERS_DB, sessionId, key)
      uploadedKeys.push(key)
      await c.env.MOVERS_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type } })
      const url = new URL(c.req.url)
      let host = c.req.header('host')
      if (host?.startsWith('0.0.0.0')) {
        host = host.replace('0.0.0.0', 'localhost')
        if (!host.includes(':')) host = `${host}:${url.port || '8787'}`
      }
      const origin = host ? `${url.protocol}//${host}` : url.origin
      uploads.push({ url: `${origin}/api/images/${key}`, receipt })
    }
    return c.json({ uploads })
  } catch {
    await Promise.allSettled(uploadedKeys.map((key) => c.env.MOVERS_BUCKET.delete(key)))
    return c.json({ error: 'Failed to upload images' }, 500)
  }
})

images.get('/:key', async (c) => {
  const key = c.req.param('key')
  const object = await c.env.MOVERS_BUCKET.get(key)

  if (!object) return c.json({ error: 'Image not found' }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)

  return new Response(object.body, { headers })
})

export default images
