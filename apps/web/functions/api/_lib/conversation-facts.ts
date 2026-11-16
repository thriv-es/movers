import type {
  ConversationCommand,
  ConversationFact,
  ConversationSnapshot,
} from '../../../src/data/z-common/z-conversation'
import type { ChatMessage } from '../../../src/data/types/move-demo.types'

type DetailCommand = Extract<ConversationCommand, { type: 'details.patch' }>
export function volunteeredDistance(text: string): number | null {
  const matches = [
    ...text.matchAll(/(?<![-\d.])(\d+(?:\.\d+)?)\s*(km|kilometers?|kilometres?|miles?|meters?|metres?)\b/gi),
  ]
  if (matches.length !== 1) return null
  const match = matches[0]
  const value = Number(match?.[1])
  const unit = match?.[2]?.toLowerCase() ?? ''
  return unit.startsWith('k') ? value / 1.609344 : /^mi/.test(unit) ? value : value / 1609.344
}
/** The interpreter selects facts; the server checks their source and owns units/address retention. */
export function validateDetailFacts(
  command: DetailCommand,
  supplied: ConversationFact[],
  snapshot: ConversationSnapshot,
  messages: ChatMessage[],
): DetailCommand | null {
  if (command.route) throw new Error('Invalid conversation output') // provider success is server-only
  const latest = messages.at(-1)
  const source = latest?.role === 'user' ? latest : undefined
  const patch = { ...command.patch }
  const facts = [...(command.facts ?? supplied)]
  if (facts.some((fact) => !source || fact.sourceMessageId !== source.id || !source.content.includes(fact.wording)))
    throw new Error('Invalid conversation output')
  if (new Set(facts.map((fact) => fact.field)).size !== facts.length) throw new Error('Invalid conversation output')
  for (const field of Object.keys(patch) as (keyof typeof patch)[]) {
    let fact = facts.find((fact) => fact.field === field || (field === 'date' && fact.field === 'dateWindow'))
    if (!fact && source && source.content.trim().length <= 1000) {
      fact = {
        field,
        sourceMessageId: source.id,
        wording: source.content.trim(),
        uncertainty: 'uncertain',
        precision:
          field === 'from' || field === 'to' ? (/\d/.test(String(patch[field])) ? 'address' : 'city') : 'unknown',
        correction: false,
      }
      facts.push(fact)
    }
    if (!fact) throw new Error('Invalid conversation output')
    if (fact.field === 'dateWindow' && patch.date !== null) throw new Error('Invalid conversation output')
    if (field === 'from' || field === 'to') {
      const known = snapshot.moveDetails[field]
      const value = patch[field]
      if (typeof value === 'string' && !value.trim()) throw new Error('Invalid conversation output')
      if (known && value && /\d/.test(known) && !/\d/.test(value) && !fact?.correction) delete patch[field]
    }
    if (field === 'distanceMiles' && patch.distanceMiles !== null) {
      const distance = volunteeredDistance(source?.content ?? '')
      if (distance === null) throw new Error('Invalid conversation output')
      patch.distanceMiles = distance
    }
  }
  const retained = facts.filter((fact) => (fact.field === 'dateWindow' ? 'date' in patch : fact.field in patch))
  if (!Object.keys(patch).length) return null
  return { type: 'details.patch', patch, ...(retained.length ? { facts: retained } : {}) }
}
