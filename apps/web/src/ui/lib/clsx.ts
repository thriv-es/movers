export type ClassValue = ClassValue[] | ClassDictionary | string | number | undefined | null | boolean

export interface ClassDictionary {
  [id: string]: boolean | undefined | null
}

export function clsx(...args: ClassValue[]): string {
  return args.map(toVal).filter(Boolean).join(' ')
}

function toVal(mix: ClassValue): string {
  if (typeof mix === 'string' || typeof mix === 'number') {
    return mix.toString()
  }

  if (mix && typeof mix === 'object') {
    if (Array.isArray(mix)) {
      return mix.filter(Boolean).map(toVal).join(' ')
    }

    return Object.entries(mix).reduce((acc, [key, value]) => {
      if (value) {
        return `${acc} ${key}`
      }

      return acc
    }, '')
  }

  return ''
}
