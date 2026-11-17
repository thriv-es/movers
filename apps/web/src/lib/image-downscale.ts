/**
 * Shrinks phone photos before upload (MOVERS-15). A 12 MP HEIC or JPEG becomes a 1600 px JPEG of a few
 * hundred kilobytes, which uploads in seconds on mobile data and is plenty for the vision model.
 */

export const MAX_EDGE = 1600
export const JPEG_QUALITY = 0.82

export const HEIC_MESSAGE =
  'This photo is in HEIC format, which the browser cannot read. Open the photo in Photos, share it as JPEG, and try again.'

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function isHeic(file: Pick<File, 'type' | 'name'>): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
}

export function isAcceptedType(file: Pick<File, 'type' | 'name'>): boolean {
  if (ACCEPTED_TYPES.includes(file.type)) return true
  return file.type === '' && /\.(jpe?g|png|webp)$/i.test(file.name)
}

/** Target size for an image that must fit inside `maxEdge` on its longest side; never upscales. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'photo'
  return `${base}.jpg`
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * Downscales and re-encodes a photo as JPEG. Rejects HEIC with a message the customer can act on, and
 * falls back to the original file when the browser cannot decode it or is missing the canvas APIs.
 */
export async function downscaleImage(file: File, maxEdge = MAX_EDGE, quality = JPEG_QUALITY): Promise<File> {
  if (isHeic(file)) throw new Error(HEIC_MESSAGE)
  if (!isAcceptedType(file)) throw new Error('Please choose a JPEG, PNG or WebP photo.')
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This photo could not be read. Try another one or a screenshot of it.')
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await canvasToBlob(canvas, quality)
    // keep the original when re-encoding would make it bigger (small PNG icons, already tiny JPEGs)
    if (blob.size >= file.size && width === bitmap.width && height === bitmap.height) return file
    return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified })
  } finally {
    bitmap.close()
  }
}
