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

/** Container validation only: bounds, required headers and compressed payloads, not pixel decoding. */
function validImage(data: Uint8Array, mimeType: string): boolean {
  if (!data.length || data.length > MAX_IMAGE_BYTES) return false
  if (mimeType === 'image/jpeg') return validJpeg(data)
  if (mimeType === 'image/png') return validPng(data)
  return mimeType === 'image/webp' && validWebp(data)
}

function validJpeg(data: Uint8Array): boolean {
  if (data[0] !== 255 || data[1] !== 216) return false
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 2
  let frame = false
  let scan = false
  let quantization = false
  let huffman = false
  while (offset < data.length) {
    if (data[offset++] !== 255) return false
    while (data[offset] === 255) offset++
    const marker = data[offset++]
    if (marker === 217) return offset === data.length && frame && scan && quantization
    if (
      marker === undefined ||
      marker === 0 ||
      marker === 216 ||
      (marker >= 208 && marker <= 215) ||
      offset + 2 > data.length
    )
      return false
    const length = view.getUint16(offset)
    const end = offset + length
    if (length < 2 || end > data.length) return false
    if (marker === 219) {
      // Each quantization table has a selector and 64 one- or two-byte entries.
      let table = offset + 2
      while (table < end) {
        const precision = (data[table] ?? 255) >> 4
        if (precision > 1) return false
        table += 1 + 64 * (precision + 1)
      }
      if (table !== end || length === 2) return false
      quantization = true
    }
    if (marker === 196) {
      let table = offset + 2
      while (table < end) {
        if (table + 17 > end || (data[table] ?? 255) >> 4 > 1) return false
        let symbols = 0
        for (let index = table + 1; index <= table + 16; index++) symbols += data[index] ?? 0
        if (!symbols || symbols > 256) return false
        table += 17 + symbols
      }
      if (table !== end || length === 2) return false
      huffman = true
    }
    if ([192, 193, 194].includes(marker)) {
      const components = data[offset + 7] ?? 0
      if (!components || length !== 8 + 3 * components || !view.getUint16(offset + 3) || !view.getUint16(offset + 5))
        return false
      frame = true
    }
    offset = end
    if (marker === 218) {
      const components = data[end - length + 2] ?? 0
      if (!frame || !quantization || !huffman || !components || length !== 6 + 2 * components) return false
      const start = offset
      // Entropy data may contain stuffed FF00 bytes and restart markers, but must contain payload.
      while (offset < data.length) {
        if (data[offset] !== 255) {
          offset++
          continue
        }
        const next = data[offset + 1]
        if (next === 0 || (next !== undefined && next >= 208 && next <= 215)) {
          offset += 2
          continue
        }
        break
      }
      if (offset === start) return false
      scan = true
    }
  }
  return false
}

function validPng(data: Uint8Array): boolean {
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => data[index] === byte)) return false
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 8
  let payloadBytes = 0
  let header = false
  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8))
    const end = offset + 12 + length // includes the mandatory CRC bytes
    if (end > data.length) return false
    if (!header) {
      if (type !== 'IHDR' || length !== 13 || !view.getUint32(offset + 8) || !view.getUint32(offset + 12)) return false
      if (data[offset + 18] !== 0 || data[offset + 19] !== 0 || (data[offset + 20] ?? 2) > 1) return false
      header = true
    } else if (type === 'IHDR') return false
    if (type === 'IDAT') payloadBytes += length
    if (type === 'IEND') return length === 0 && end === data.length && payloadBytes > 6
    offset = end
  }
  return false
}

function validWebp(data: Uint8Array): boolean {
  if (
    data.length < 20 ||
    String.fromCharCode(...data.subarray(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...data.subarray(8, 12)) !== 'WEBP'
  )
    return false
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (view.getUint32(4, true) + 8 !== data.length) return false
  let image = false
  // Check top-level chunks and, for animated WebP, the image chunks inside each ANMF frame.
  const chunks = (start: number, end: number, frame: boolean): boolean => {
    let offset = start
    let frameImage = false
    while (offset + 8 <= end) {
      const type = String.fromCharCode(...data.subarray(offset, offset + 4))
      const length = view.getUint32(offset + 4, true)
      const body = offset + 8
      const next = body + length + (length % 2)
      if (next > end) return false
      if (type === 'VP8 ') {
        if (
          length <= 10 ||
          (data[body] ?? 1) & 1 ||
          data[body + 3] !== 157 ||
          data[body + 4] !== 1 ||
          data[body + 5] !== 42 ||
          !(view.getUint16(body + 6, true) & 16383) ||
          !(view.getUint16(body + 8, true) & 16383)
        )
          return false
        frameImage = true
      } else if (type === 'VP8L') {
        if (length <= 5 || data[body] !== 47 || (data[body + 4] ?? 255) >> 5 !== 0) return false
        frameImage = true
      } else if (type === 'VP8X' && (frame || length !== 10)) return false
      else if (type === 'ANMF') {
        if (frame || length <= 16 || !chunks(body + 16, body + length, true)) return false
        frameImage = true
      }
      offset = next
    }
    if (frameImage) image = true
    return offset === end && (!frame || frameImage)
  }
  return chunks(12, data.length, false) && image
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
      // workerd supports manual, not error; the non-2xx gate below rejects redirects without following them.
      const response = path ? await fetch(`${origin}${path}`, { redirect: 'manual' }) : null
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
