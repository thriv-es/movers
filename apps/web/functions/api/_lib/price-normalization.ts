import type { Confidence } from '../../../src/data'

export class PriceFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PriceFormatError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** The model suggests line-item amounts; the server owns their arithmetic and shape. */
export function normalizePriceReply(raw: unknown, hasItems: boolean): {
  currency: 'USD'
  total: number
  breakdown: Record<string, number>
  explanation?: string
  confidence?: Confidence
} {
  if (!isPlainObject(raw) || raw.currency !== 'USD' || !isPlainObject(raw.breakdown)) {
    throw new PriceFormatError('Invalid price reply')
  }
  const breakdown = raw.breakdown
  const entries = Object.entries(breakdown)
  if (hasItems && entries.length === 0) throw new PriceFormatError('Missing line items')

  const lines = new Map<string, { label: string; cents: number }>()
  for (const [rawLabel, amount] of entries) {
    if (typeof amount !== 'number') throw new PriceFormatError('Invalid amount')
    const cents = Math.round(amount * 100)
    if (amount < 0 || !Number.isFinite(amount) || !Number.isSafeInteger(cents) || Math.abs(amount * 100 - cents) > 1e-7) {
      throw new PriceFormatError('Invalid amount')
    }
    const label = rawLabel.trim()
    if (label.length < 1 || label.length > 120) throw new PriceFormatError('Invalid label')
    const key = label.toLowerCase()
    const previous = lines.get(key)
    lines.set(key, { label: previous?.label ?? label, cents: (previous?.cents ?? 0) + cents })
  }

  const totalCents = [...lines.values()].reduce((sum, line) => sum + line.cents, 0)
  if (!Number.isSafeInteger(totalCents)) throw new PriceFormatError('Invalid total')
  return {
    currency: 'USD',
    total: totalCents / 100,
    breakdown: Object.fromEntries([...lines.values()].map(({ label, cents }) => [label, cents / 100])),
    ...(typeof raw.explanation === 'string' ? { explanation: raw.explanation.slice(0, 1000) } : {}),
    ...(raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
      ? { confidence: raw.confidence }
      : {}),
  }
}
