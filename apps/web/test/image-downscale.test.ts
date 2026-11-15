/**
 * Phone photo preparation (MOVERS-15): sizing math, HEIC rejection, and the decode fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HEIC_MESSAGE, MAX_EDGE, downscaleImage, fitWithin, isAcceptedType, isHeic } from '../src/lib/image-downscale'

describe('fitWithin', () => {
  it('leaves small images alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1600, 1200)).toEqual({ width: 1600, height: 1200 })
  })

  it('scales the long edge down to the limit and keeps the ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: MAX_EDGE, height: 1200 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: MAX_EDGE })
    expect(fitWithin(5000, 100, 1000)).toEqual({ width: 1000, height: 20 })
  })
})

describe('type checks', () => {
  it('spots HEIC by type or extension', () => {
    expect(isHeic({ type: 'image/heic', name: 'IMG_1.HEIC' })).toBe(true)
    expect(isHeic({ type: '', name: 'IMG_1.heif' })).toBe(true)
    expect(isHeic({ type: 'image/jpeg', name: 'IMG_1.jpg' })).toBe(false)
  })

  it('accepts jpeg, png and webp, including untyped files by extension', () => {
    expect(isAcceptedType({ type: 'image/jpeg', name: 'a.jpg' })).toBe(true)
    expect(isAcceptedType({ type: '', name: 'a.PNG' })).toBe(true)
    expect(isAcceptedType({ type: 'application/pdf', name: 'a.pdf' })).toBe(false)
  })
})

describe('downscaleImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects HEIC with the Photos instruction', async () => {
    const file = new File([new Uint8Array(10)], 'IMG_2.HEIC', { type: 'image/heic' })
    await expect(downscaleImage(file)).rejects.toThrow(HEIC_MESSAGE)
  })

  it('rejects non-image files', async () => {
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    await expect(downscaleImage(file)).rejects.toThrow(/JPEG, PNG or WebP/)
  })

  it('returns the original file when the browser has no createImageBitmap', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const file = new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' })
    await expect(downscaleImage(file)).resolves.toBe(file)
  })

  it('explains an undecodable photo', async () => {
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('decode')))
    const file = new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' })
    await expect(downscaleImage(file)).rejects.toThrow(/could not be read/)
  })
})
