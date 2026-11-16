/** Complete 1×1 image files, not header-only stubs. */
// Baseline grayscale JPEG: unit quantization, one-symbol DC/AC Huffman tables,
// one zero-coefficient block (DC=0, AC=EOB), and entropy bits 00 padded with ones.
export const jpeg = new Uint8Array([
  255,
  216,
  255,
  219,
  0,
  67,
  0,
  ...Array(64).fill(1),
  255,
  192,
  0,
  11,
  8,
  0,
  1,
  0,
  1,
  1,
  1,
  17,
  0,
  255,
  196,
  0,
  38,
  0,
  1,
  ...Array(15).fill(0),
  0,
  16,
  1,
  ...Array(15).fill(0),
  0,
  255,
  218,
  0,
  8,
  1,
  1,
  0,
  0,
  63,
  0,
  63,
  255,
  217,
])
export const png = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII='),
  (char) => char.charCodeAt(0),
)
export const webp = Uint8Array.from(atob('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'), (char) =>
  char.charCodeAt(0),
)

const pngStub = new Uint8Array(24)
pngStub.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
pngStub[19] = 1
pngStub[23] = 1
export const truncatedContainers = [
  { name: 'JPEG SOI/EOI only', mimeType: 'image/jpeg', bytes: new Uint8Array([255, 216, 255, 217]) },
  { name: 'PNG partial IHDR only', mimeType: 'image/png', bytes: pngStub },
  {
    name: 'WebP RIFF/fourcc only',
    mimeType: 'image/webp',
    bytes: new Uint8Array([82, 73, 70, 70, 8, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32]),
  },
]
