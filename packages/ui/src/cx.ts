/** Joins class names, skipping falsy parts. Kept local so the package has no runtime dependencies. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
