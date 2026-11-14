import { clsx, type ClassValue } from './clsx'
export type { ClassValue } from './clsx'
import { extendTailwindMerge } from 'tailwind-merge'
import { withFluid } from '@fluid-tailwind/tailwind-merge'

type AdditionalClassGroups = 'form'

/**
 * Customized tailwind-merge instance.
 *
 * Register any custom Tailwind class groups here so tailwind-merge can handle
 * conflicting utilities correctly (e.g. custom font stacks, form-* utilities).
 */
export const twMergeCustom = extendTailwindMerge<AdditionalClassGroups>(
  {
    override: {},
    extend: {
      classGroups: {
        'font-family': ['font-sans', 'font-serif', 'font-mono', 'font-heading'],
        form: ['input', 'checkbox', 'textarea', 'select', 'multiselect', 'radio'].map((v) => `form-${v}`),
      },
    },
  },
  withFluid,
)

/**
 * Combines clsx() conditional class logic with tailwind-merge conflict resolution.
 * Use this instead of plain template literals whenever Tailwind classes might conflict.
 */
export function cn(...args: ClassValue[]): string {
  return twMergeCustom(clsx(args))
}
