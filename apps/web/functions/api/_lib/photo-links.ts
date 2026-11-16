import type { AiImage } from './ai-client'
import { type PhotoRef, verifyPhotoReceipt } from './photo-receipts'
import type { Bindings } from './types'
import { samplePhotoPath } from '../../../src/data/sample-photos'

export type PhotoLinkStatus = 'eligible' | 'unlinked' | 'unavailable'
export interface LinkedPhoto {
  url: string
  status: PhotoLinkStatus
  reason: string
  image?: AiImage
}
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** Bounded image signature check, not a full codec decoder (Workers has no image decoder). */
function validImage(data: Uint8Array, mimeType: string): boolean {
  if (!data.length || data.length > MAX_IMAGE_BYTES) return false
  if (mimeType === 'image/jpeg')
    return (
      data.length >= 4 &&
      data[0] === 255 &&
      data[1] === 216 &&
      data[2] === 255 &&
      data.at(-2) === 255 &&
      data.at(-1) === 217
    )
  if (mimeType === 'image/png')
    return (
      data.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => data[index] === byte) &&
      String.fromCharCode(...data.slice(12, 16)) === 'IHDR' &&
      new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(16) > 0 &&
      new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(20) > 0
    )
  return (
    mimeType === 'image/webp' &&
    data.length >= 16 &&
    String.fromCharCode(...data.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...data.slice(8, 12)) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(String.fromCharCode(...data.slice(12, 16)))
  )
}

/** Input URLs are identity only. All reads use a validated key or a server-constructed bundled path. */
export async function resolvePhotoLinks(
  env: Bindings,
  requestUrl: string,
  sessionId: string,
  refs: PhotoRef[],
  sample: boolean,
): Promise<LinkedPhoto[]> {
  const origin = new URL(requestUrl).origin
  const results: LinkedPhoto[] = []
  for (const ref of refs) {
    const unlinked: LinkedPhoto = {
      url: ref.url,
      status: 'unlinked',
      reason: 'Photo is not linked to this estimate. Re-upload it to continue.',
    }
    const unavailable: LinkedPhoto = {
      url: ref.url,
      status: 'unavailable',
      reason: 'Photo bytes are unavailable or unsupported. Re-upload a JPEG, PNG or WebP image.',
    }
    let trusted = false
    try {
      const path = sample ? samplePhotoPath(ref.url, origin) : null
      let object: R2ObjectBody | null = null
      if (!path) {
        if (sample || !ref.url.startsWith(`${origin}/api/images/`)) {
          results.push(unlinked)
          continue
        }
        const encodedKey = ref.url.slice(`${origin}/api/images/`.length)
        // Upload keys contain only filename-safe characters. Reject URL normalization, escapes and extra segments.
        if (!/^[A-Za-z0-9_.-]+$/.test(encodedKey) || encodedKey === '.' || encodedKey === '..') {
          results.push(unlinked)
          continue
        }
        const key = decodeURIComponent(encodedKey)
        if (!env.MOVERS_DB || !ref.receipt || !(await verifyPhotoReceipt(env.MOVERS_DB, sessionId, key, ref.receipt))) {
          results.push(unlinked)
          continue
        }
        trusted = true
        object = await env.MOVERS_BUCKET.get(key)
        if (!object) {
          results.push(unavailable)
          continue
        }
      }
      trusted = true
      const response = path ? await fetch(`${origin}${path}`, { redirect: 'error' }) : null
      if (response && !response.ok) {
        results.push(unavailable)
        continue
      }
      const mimeType =
        (response ? response.headers.get('content-type') : object?.httpMetadata?.contentType)
          ?.split(';')[0]
          ?.trim()
          .toLowerCase() ?? ''
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        results.push(unavailable)
        continue
      }
      const size = response ? Number(response.headers.get('content-length')) : object?.size
      if (size && size > MAX_IMAGE_BYTES) {
        results.push(unavailable)
        continue
      }
      const source = response ?? object
      if (!source) {
        results.push(unavailable)
        continue
      }
      const data = new Uint8Array(await source.arrayBuffer())
      if (!validImage(data, mimeType)) {
        results.push(unavailable)
        continue
      }
      results.push({
        url: ref.url,
        status: 'eligible',
        reason: 'Photo linkage and image bytes verified; relevance has not been assessed.',
        image: { data, mimeType },
      })
    } catch {
      results.push(trusted ? unavailable : unlinked)
    }
  }
  return results
}
