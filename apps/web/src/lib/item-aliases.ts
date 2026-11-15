const aliases = new Map<string, string>([['couch', 'sofa']])

/** Normalize item labels for inventory matching; only measured aliases are mapped. */
export function canonicalItemType(type: string): string {
  const key = type.trim().toLowerCase()
  return aliases.get(key) ?? key
}
