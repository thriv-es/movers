import type { MoveDetails } from '@/data'

export function formatMoney(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
}

export function formatDetail(key: keyof MoveDetails, value: string | number | boolean | null): string {
  if (value === null) return 'Not yet'
  switch (key) {
    case 'distanceMiles':
      return `${value} miles`
    case 'originFloor':
    case 'destinationFloor':
      return value === 1 ? 'Ground floor' : `Floor ${value}`
    case 'originElevator':
    case 'destinationElevator':
      return value ? 'Yes' : 'No'
    default:
      return String(value)
  }
}

const ACRONYMS = new Set(['tv', 'ac', 'pc'])

/** Human label for an inventory kind: `small_moving_box_packed` -> `Small moving box packed`, `tv` -> `TV`. */
export function titleCase(text: string): string {
  const clean = text.replace(/[_-]+/g, ' ').trim()
  if (ACRONYMS.has(clean.toLowerCase())) return clean.toUpperCase()
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}
