import { z } from 'zod'
import {
  type ConversationCommand,
  type ConversationSnapshot,
  zConversationMoveDetails,
  zConversationProposal,
  zConversationRevision,
  zConversationSnapshot,
} from '../../../src/data/z-common/z-conversation'
import { zChatMessage } from '../../../src/data/z-common/z-move-demo'
import type { ChatMessage, MoveDetails } from '../../../src/data/types/move-demo.types'
import { canonicalItemType } from '../../../src/lib/item-aliases'

// Task 1's schema is the protocol. Tighten nested stripping objects at this ingress:
// reject unknown private fields instead of ever forwarding an unvalidated request object.
const zSafeSnapshot = zConversationSnapshot
  .extend({
    moveDetails: zConversationMoveDetails.strict(),
    review: zConversationSnapshot.shape.review.extend({
      followUps: zConversationSnapshot.shape.review.shape.followUps.strict(),
    }),
    analysis: zConversationSnapshot.shape.analysis
      .unwrap()
      .extend({
        estimatedBoxes: zConversationSnapshot.shape.analysis.unwrap().shape.estimatedBoxes.strict(),
      })
      .nullable(),
  })
  .superRefine((state, context) => {
    if (new Set(state.photos.map((photo) => photo.id)).size !== state.photos.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate photo identifiers' })
    }
  })
export const zConversationRequest = z
  .object({
    messages: z
      .array(zChatMessage.extend({ id: z.string().max(128), content: z.string().max(12000) }).strict())
      .max(200),
    snapshot: zSafeSnapshot,
  })
  .strict()

export const zConversationResponse = z
  .object({
    reply: z
      .string()
      .trim()
      .min(1)
      .max(3000)
      .refine(
        (reply) =>
          [...reply].every((character) => character.charCodeAt(0) >= 32 || '\n\r\t'.includes(character)) &&
          !/https?:\/\/|data:|```|<\/?[a-z]|\{\s*"/i.test(reply),
      ),
    basedOnRevision: zConversationRevision,
    proposals: z.array(zConversationProposal).max(12),
  })
  .strict()
export type ConversationResponse = z.infer<typeof zConversationResponse>

// Model-only selector: no free text, status, amount or success claim can become visible prose.
const zClarification = z.enum(['date', 'address_side', 'address_city', 'item', 'photo'])
const clarificationReplies: Record<z.infer<typeof zClarification>, string> = {
  date: 'Please clarify the date using YYYY-MM-DD.',
  address_side: 'Is that street address for the origin or destination?',
  address_city: 'Please provide the complete street address and city for this replacement.',
  item: 'Which named inventory item should be changed? Please use its review control to confirm.',
  photo: 'Which uncertain photo do you mean? Please use its Keep or Exclude review controls.',
}
const zModelConversationTurn = zConversationResponse.extend({ clarification: zClarification.optional() })

const sameType = (left: string, right: string) => canonicalItemType(left) === canonicalItemType(right)
function currentReference(command: ConversationCommand, state: ConversationSnapshot): boolean {
  switch (command.type) {
    case 'details.patch':
      return (
        command.patch.date == null ||
        (/^\d{4}-\d{2}-\d{2}$/.test(command.patch.date) && numericDate(command.patch.date) === command.patch.date)
      )
    case 'item.add':
      return (
        state.inventory
          .filter((item) => sameType(item.type, command.item.type))
          .reduce((sum, item) => sum + item.count, command.item.count) <= 10000
      )
    case 'item.count':
    case 'item.remove':
      return state.inventory.some((item) => sameType(item.type, command.itemType))
    case 'photo.decide':
      return state.photos.some((photo) => photo.id === command.photoId && photo.status === 'uncertain')
    case 'duplicate.resolve':
      return (
        state.inventory.some((item) => sameType(item.type, command.itemType)) &&
        state.review.pendingDuplicates.some((duplicate) => sameType(duplicate.item, command.itemType)) &&
        !state.review.duplicateResolutions[canonicalItemType(command.itemType)]
      )
    default:
      return true
  }
}

/** Reject the entire batch on error; never leak a parsed partial response or model text. */
export function parseConversationTurn(
  text: string,
  snapshot: ConversationSnapshot,
  messages: ChatMessage[] = [],
): ConversationResponse {
  if (text.length > 24000) throw new Error('Invalid conversation output')
  const turn = zModelConversationTurn.parse(JSON.parse(text))
  const ids = new Set<string>()
  const targets = new Set<string>()
  if (turn.basedOnRevision !== snapshot.revision) throw new Error('Invalid conversation revision')
  for (const proposal of turn.proposals) {
    const command = proposal.command
    const target =
      command.type === 'details.patch'
        ? 'details'
        : 'itemType' in command
          ? `item:${canonicalItemType(command.itemType)}`
          : command.type === 'item.add'
            ? `item:${canonicalItemType(command.item.type)}`
            : command.type === 'photo.decide'
              ? `photo:${command.photoId}`
              : command.type === 'followUp.answer'
                ? `followUp:${command.key}`
                : command.type
    if (
      proposal.expectedRevision !== snapshot.revision ||
      ids.has(proposal.id) ||
      targets.has(target) ||
      !currentReference(command, snapshot)
    )
      throw new Error('Invalid conversation proposal')
    ids.add(proposal.id)
    targets.add(target)
  }
  // IDs are opaque, request-local server IDs; no model-created receipt/reference can become authority.
  return zConversationResponse.parse({
    // Intentionally never return turn.reply: all visible prose is authored by the server.
    reply: renderConversationReply(
      messages,
      snapshot,
      turn.proposals.map((proposal) => proposal.command),
      turn.clarification,
    ),
    basedOnRevision: turn.basedOnRevision,
    proposals: turn.proposals.map((proposal) => ({ ...proposal, id: `proposal-${crypto.randomUUID()}` })),
  })
}

function numericDate(value: string): string | null {
  let year: number
  let month: number
  let day: number
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    ;[year = Number.NaN, month = Number.NaN, day = Number.NaN] = value.split('-').map(Number)
  } else {
    const [a = Number.NaN, b = Number.NaN, y = Number.NaN] = value.split(/[./]/).map(Number)
    year = y
    // Same-number dates and one component >12 are unambiguous; otherwise ask.
    if (a === b || a > 12) {
      day = a
      month = b
    } else if (b > 12) {
      day = b
      month = a
    } else return null
  }
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    year < 1000 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  )
    return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
const addressFragment = (value: string) =>
  /^\d+\s+\p{L}/u.test(value) || /\b(street|st\.?|road|rd\.?|avenue|ave\.?|lane)\b/i.test(value)
function addressWithCity(value: string, known: string | null, replacing = false): string | null {
  const parts = value.split(',').map((part) => part.trim())
  const tail = parts.at(-1) ?? ''
  const unit = /^(?:apt\.?|apartment|suite|unit|floor)\b/i
  // A comma-delimited explicit city is a complete replacement, never a fragment to append to.
  if (parts.length > 1 && /^[\p{L}][\p{L} .'-]*$/u.test(tail) && !unit.test(tail)) return value
  if (!known || value.toLowerCase().includes(known.toLowerCase())) return value
  // A correction without a city, or an apparent unseparated city after the street suffix, is ambiguous.
  const afterStreet = /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane)\s+(.+)$/i.exec(value)?.[1]
  if (replacing || (afterStreet && !unit.test(afterStreet)) || (parts.length > 1 && !unit.test(tail))) return null
  // Retain a known city only for a city-less street/unit fragment.
  const city = known.includes(',') ? known.split(',').at(-1)?.trim() : !/\d/.test(known) ? known : null
  if (!city) return null
  return !value.toLowerCase().includes(city.toLowerCase()) ? `${value}, ${city}` : value
}
const sideFromQuestion = (question: string): 'from' | 'to' | null => {
  const origin = /\borigin\b|\bfrom\b/i.test(question)
  const destination = /\bdestination\b|\bto address\b|moving to\b/i.test(question)
  return origin !== destination ? (origin ? 'from' : 'to') : null
}

/** Intentionally bounded English synthetic grammar; not a substitute for model evaluation. */
function extractDetails(
  text: string,
  question: string,
  state: ConversationSnapshot,
): {
  patch: Partial<MoveDetails>
  clarification?: string
} {
  const patch: Partial<MoveDetails> = {}
  let clarification: string | undefined
  if (/^(add|set|remove|keep|exclude)\b/i.test(text)) return { patch }
  const dates = [...text.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4})\b/g)]
  if (dates.length === 1) {
    const date = numericDate(dates[0]?.[0] ?? '')
    if (date) patch.date = date
    else clarification = 'Please clarify the date using YYYY-MM-DD.'
  } else if (dates.length > 1) clarification = 'Which move date should be used? Please use YYYY-MM-DD.'

  const labels = [...text.matchAll(/\b(from|to|(?:origin|destination) (?:street(?: address)?|address))\s*:?\s+/gi)]
  let foundPlace = false
  for (const [index, label] of labels.entries()) {
    const key = /^(from|origin)/i.test(label[1] ?? '') ? 'from' : 'to'
    let value = (
      text
        .slice((label.index ?? 0) + label[0].length, labels[index + 1]?.index ?? text.length)
        .split(/\s+on\s+\d|[,;]\s*(?:date|distance|origin|destination)\b|\s+(?:date|distance)\s*(?:is|:)/i)[0] ?? ''
    )
      .replace(/[\s,;.]+$/, '')
      .trim()
    if (!value || /^(?:clear|unknown|null)$/i.test(value)) continue
    // Date before location can leave a trailing comma; do not put any combined numeric date in a location.
    value = value.replace(/\s+on\s*$/i, '').trim()
    if (value.length > 300 || /\b(?:floor|elevator|miles)\b|\d{4}-\d{2}-\d{2}/i.test(value)) continue
    const place = addressFragment(value)
      ? addressWithCity(value, state.moveDetails[key], /\b(?:actually|instead|replace|correction|change)\b/i.test(text))
      : value
    if (place === null)
      clarification = 'Please include the city with that street address so the known city is retained.'
    else patch[key] = place
    foundPlace = true
  }
  const distance = /\b(?:distance(?:\s+is)?\s*:?\s*)?(?<![-\d.])(\d+(?:\.\d+)?)\s*miles\b/i.exec(text)
  if (distance) patch.distanceMiles = Number(distance[1])
  for (const [side, prefix] of [
    ['origin', 'origin'],
    ['destination', 'destination'],
  ] as const) {
    const floor = new RegExp(`\\b${side} floor\\s*(?:is|:)?\\s*(\\d+)\\b(?!\\.\\d)`, 'i').exec(text)
    if (floor && Number(floor[1]) > 0) patch[`${prefix}Floor`] = Number(floor[1])
    const elevator = new RegExp(`\\b${side} elevator\\s*(?:is|:)?\\s*(yes|no|true|false)\\b`, 'i').exec(text)
    if (elevator) patch[`${prefix}Elevator`] = /^(yes|true)$/i.test(elevator[1] ?? '')
  }
  const clearFields = {
    from: 'from',
    origin: 'from',
    destination: 'to',
    to: 'to',
    date: 'date',
    distance: 'distanceMiles',
    'origin floor': 'originFloor',
    'destination floor': 'destinationFloor',
    'origin elevator': 'originElevator',
    'destination elevator': 'destinationElevator',
  } as const
  for (const [name, key] of Object.entries(clearFields)) {
    if (new RegExp(`\\b(?:clear|forget) ${name}\\s*[.!]?$`, 'i').test(text)) patch[key] = null
  }
  if (!foundPlace && !dates.length && !Object.keys(patch).length) {
    const side = sideFromQuestion(question)
    if (/^\d+(?:\.\d+)?$/.test(text) && /distance.*miles/i.test(question)) patch.distanceMiles = Number(text)
    else if (side && /floor/i.test(question) && /^\d+$/.test(text) && Number(text) > 0) {
      patch[side === 'from' ? 'originFloor' : 'destinationFloor'] = Number(text)
    } else if (side && /elevator/i.test(question) && /^(yes|no)$/i.test(text)) {
      patch[side === 'from' ? 'originElevator' : 'destinationElevator'] = /^yes$/i.test(text)
    } else if (addressFragment(text)) {
      if (side) {
        const place = addressWithCity(text, state.moveDetails[side])
        if (place === null)
          clarification = 'Please include the city with that street address so the known city is retained.'
        else patch[side] = place
      } else clarification = 'Is that street address for the origin or destination?'
    } else if (
      side &&
      /address|city|where.*moving/i.test(question) &&
      /^[\p{L}][\p{L} .'-]{1,100}$/u.test(text) &&
      !/^(yes|no|hello|thanks|okay|not sure)$/i.test(text)
    )
      patch[side] = text
  }
  return { patch, clarification }
}

function nextQuestion(state: ConversationSnapshot): string {
  const details = state.moveDetails
  const questions: [keyof MoveDetails, string][] = [
    ['from', 'What is the origin city or address?'],
    ['to', 'What is the destination city or address?'],
    ['date', 'What is the move date (YYYY-MM-DD)?'],
    ['distanceMiles', 'What is the approximate distance in miles?'],
    ['originFloor', 'What is the origin floor (positive floor number)?'],
    ['originElevator', 'Is there an origin elevator?'],
    ['destinationFloor', 'What is the destination floor (positive floor number)?'],
    ['destinationElevator', 'Is there a destination elevator?'],
  ]
  for (const [field, question] of questions) if (details[field] === null || details[field] === '') return question
  if (!state.detailsConfirmed) return 'Please review and confirm the move details using the details control.'
  if (!state.photos.length) return 'Please attach photos in this chat to start the inventory.'
  if (state.photos.some((photo) => ['reupload', 'unlinked', 'unavailable'].includes(photo.status))) {
    return 'Please re-upload or remove photos that are not linked before analysis.'
  }
  if (!state.analysis) return 'Use the Analyze photos control when you are ready; it requires your explicit action.'
  const uncertain = state.photos.find((photo) => photo.status === 'uncertain' && photo.decision === null)
  if (uncertain) return `For photo ${uncertain.id}, choose Keep or Exclude using its review controls.`
  if (!state.inventory.length)
    return 'Which items are missing? Add named items and positive counts, or attach clearer photos.'
  const duplicate = state.review.pendingDuplicates.find(
    (entry) => !state.review.duplicateResolutions[canonicalItemType(entry.item)],
  )
  if (duplicate) return 'Are the possible duplicate items shown in review the same object or different objects?'
  for (const key of ['garage', 'closets', 'appliances'] as const) {
    if (state.review.followUps[key] === null) return `Are there additional ${key} items missing from this inventory?`
  }
  if (state.review.wholeMoveCovered === null)
    return 'Does this inventory cover the whole move? Please explicitly answer yes or no.'
  if (!state.price)
    return state.readiness.canPrice
      ? 'Review the inventory, then use Confirm inventory and get estimate when ready.'
      : 'Review the inventory and outstanding checks before using the estimate control.'
  if (!state.status.estimateSaved) return 'Use the explicit estimate save/retry control before requesting a date.'
  if (!state.status.dateRequested)
    return 'Use the contact and date request control; a date request is not a confirmed booking.'
  if (!state.status.quoteRequestCount)
    return 'You can choose mover recipients and explicitly send quote requests using the quote control.'
  return 'Your current results are available in the data panel. What would you like to review or change?'
}

function reviewCommands(text: string, state: ConversationSnapshot, question: string): ConversationCommand[] {
  const commands: ConversationCommand[] = []
  if (/^(yes|no)[.!]?$/i.test(text)) {
    const answer = /^yes/i.test(text)
    const keys = (['garage', 'closets', 'appliances'] as const).filter((key) => question.toLowerCase().includes(key))
    if (keys.length === 1 && /additional.*items missing/i.test(question) && keys[0]) {
      commands.push({ type: 'followUp.answer', key: keys[0], answer })
    } else if (/does this inventory cover the whole move/i.test(question))
      commands.push({ type: 'coverage.answer', answer })
  }
  const add = /^add\s+(\d+)\s+([\p{L}][\p{L} -]{0,100})[.!]?$/iu.exec(text)
  if (add && Number(add[1]) > 0 && Number(add[1]) <= 10000) {
    commands.push({ type: 'item.add', item: { type: canonicalItemType(add[2] ?? ''), count: Number(add[1]) } })
  }
  const count = /^set\s+(.+?)\s+count\s+to\s+(\d+)[.!]?$/i.exec(text)
  if (
    count &&
    Number(count[2]) > 0 &&
    Number(count[2]) <= 10000 &&
    state.inventory.some((item) => sameType(item.type, count[1] ?? ''))
  ) {
    commands.push({ type: 'item.count', itemType: canonicalItemType(count[1] ?? ''), count: Number(count[2]) })
  }
  const remove = /^remove\s+(.+?)[.!]?$/i.exec(text)
  if (remove && state.inventory.some((item) => sameType(item.type, remove[1] ?? ''))) {
    commands.push({ type: 'item.remove', itemType: canonicalItemType(remove[1] ?? '') })
  }
  const photo = /^(keep|exclude)\s+([a-zA-Z0-9_-]+)[.!]?$/i.exec(text)
  if (photo && state.photos.some((entry) => entry.id === photo[2] && entry.status === 'uncertain')) {
    commands.push({
      type: 'photo.decide',
      photoId: photo[2] ?? '',
      decision: (photo[1] ?? '').toLowerCase() as 'keep' | 'exclude',
    })
  }
  for (const duplicate of state.review.pendingDuplicates) {
    const escaped = duplicate.item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const answer = new RegExp(`^${escaped} (?:are |is )?(same|different)(?: objects?)?[.!]?$`, 'i').exec(text)
    if (answer)
      commands.push({
        type: 'duplicate.resolve',
        itemType: duplicate.item,
        resolution: (answer[1] ?? '').toLowerCase() as 'same' | 'different',
      })
  }
  for (const key of ['garage', 'closets', 'appliances'] as const) {
    if (new RegExp(`^(?:no ${key}(?: items)?|${key}:? no)[.!]?$`, 'i').test(text))
      commands.push({ type: 'followUp.answer', key, answer: false })
    if (new RegExp(`^(?:yes ${key}(?: items)?|${key}:? yes)[.!]?$`, 'i').test(text))
      commands.push({ type: 'followUp.answer', key, answer: true })
  }
  if (/^(?:the )?whole move (?:is )?(covered|not covered)[.!]?$/i.test(text)) {
    commands.push({ type: 'coverage.answer', answer: !/not covered/i.test(text) })
  }
  const action = /^(analyze photos|get estimate|request (?:this )?date|send quote requests)[.!]?$/i.exec(text)
  if (action)
    commands.push({
      type: 'request.action',
      action: /^analyze/i.test(text)
        ? 'analyze'
        : /^get/i.test(text)
          ? 'price'
          : /^send/i.test(text)
            ? 'quotes'
            : 'schedule',
    })
  return commands
}

/** Both real and offline turns use fixed server prose, never model-authored result/status text. */
function renderConversationReply(
  messages: ChatMessage[],
  snapshot: ConversationSnapshot,
  commands: ConversationCommand[],
  selector?: z.infer<typeof zClarification>,
): string {
  const latest = messages.at(-1)
  const text = latest?.role === 'user' ? latest.content.trim() : ''
  const question = messages.at(-2)?.role === 'assistant' ? (messages.at(-2)?.content ?? '') : ''
  const { clarification } = extractDetails(text, question, snapshot)
  const projected = structuredClone(snapshot)
  for (const command of commands) {
    if (command.type !== 'details.patch' && command.type !== 'request.action') {
      projected.price = null
      projected.status.estimateSaved = false
      projected.status.dateRequested = false
      projected.status.quoteRequestCount = 0
    }
    if (command.type === 'item.add') {
      const existing = projected.inventory.find((item) => sameType(item.type, command.item.type))
      if (existing) existing.count += command.item.count
      else projected.inventory.push({ ...command.item })
    } else if (command.type === 'item.count') {
      for (const item of projected.inventory) if (sameType(item.type, command.itemType)) item.count = command.count
    } else if (command.type === 'item.remove') {
      projected.inventory = projected.inventory.filter((item) => !sameType(item.type, command.itemType))
    } else if (command.type === 'details.patch') {
      projected.moveDetails = { ...projected.moveDetails, ...command.patch }
      projected.detailsConfirmed = false
    } else if (command.type === 'followUp.answer') projected.review.followUps[command.key] = command.answer
    else if (command.type === 'coverage.answer') projected.review.wholeMoveCovered = command.answer
    else if (command.type === 'photo.decide') {
      const photo = projected.photos.find((entry) => entry.id === command.photoId)
      if (photo) photo.decision = command.decision
    } else if (command.type === 'duplicate.resolve')
      projected.review.duplicateResolutions[canonicalItemType(command.itemType)] = command.resolution
  }
  return (
    clarification ??
    (selector ? clarificationReplies[selector] : undefined) ??
    (/^remove\b/i.test(text) && !commands.length
      ? 'Which named inventory item should be removed? Please use its review control to confirm.'
      : nextQuestion(projected))
  )
}

/** Deterministic and state-aware: only the latest user answer can propose changes. No operations execute here. */
export function mockConversationTurn(messages: ChatMessage[], snapshot: ConversationSnapshot): ConversationResponse {
  const latest = messages.at(-1)
  const text = latest?.role === 'user' ? latest.content.trim() : ''
  const question = messages.at(-2)?.role === 'assistant' ? (messages.at(-2)?.content ?? '') : ''
  const { patch } = extractDetails(text, question, snapshot)
  const commands: ConversationCommand[] = Object.keys(patch).length
    ? [{ type: 'details.patch', patch }]
    : reviewCommands(text, snapshot, question)
  return {
    reply: renderConversationReply(messages, snapshot, commands),
    basedOnRevision: snapshot.revision,
    proposals: commands.map((command, index) => ({
      id: `mock-${index}`,
      expectedRevision: snapshot.revision,
      command,
    })),
  }
}
