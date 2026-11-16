/** Exact bundled assets; shared by draft migration and the server link gate. */
export const SAMPLE_PHOTO_PATHS = ['/sample/living-room.jpg', '/sample/bedroom.jpg', '/sample/kitchen.jpg']

/** Require an absolute canonical URL, not a normalized lookalike or alternate origin. */
export function samplePhotoPath(value: string, origin: string): string | null {
  return SAMPLE_PHOTO_PATHS.find((path) => value === `${origin}${path}`) ?? null
}
