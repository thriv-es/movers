/**
 * Outgoing email, v1: nothing is sent. The message is composed and written to the server log so the flow can be
 * followed end to end. Swap `deliverEmail` for a real provider when movers are onboarded.
 */
import type { EstimateRecord, MoverRecord } from '../../../src/data'

export interface OutboundEmail {
  to: string
  subject: string
  body: string
}

const money = (value: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)

export function composeQuoteRequestEmail(estimate: EstimateRecord, mover: MoverRecord, note: string): OutboundEmail {
  const { moveDetails, price, items, contact } = estimate
  const inventory = items.map((item) => `- ${item.count} x ${item.type}`).join('\n')
  const lines = [
    `Hi ${mover.name},`,
    '',
    'A customer on Movers would like a quote from you.',
    '',
    `From: ${moveDetails.from ?? 'unknown'}`,
    `To: ${moveDetails.to ?? 'unknown'}`,
    `Date: ${contact?.requestedDate ?? moveDetails.date ?? 'flexible'}`,
    `Distance: ${moveDetails.distanceMiles === null ? 'unknown' : `${moveDetails.distanceMiles} miles`}`,
    `Origin: floor ${moveDetails.originFloor ?? '?'}${moveDetails.originElevator === false ? ', no elevator' : ''}`,
    `Destination: floor ${moveDetails.destinationFloor ?? '?'}${moveDetails.destinationElevator === false ? ', no elevator' : ''}`,
    '',
    `Our estimate: ${money(price.low, price.currency)} to ${money(price.high, price.currency)}`,
    '',
    'Inventory:',
    inventory || '- (none listed)',
    '',
    note ? `Customer note: ${note}` : 'Customer note: (none)',
    '',
    contact
      ? `Reply to ${contact.name} at ${contact.email}${contact.phone ? ` or ${contact.phone}` : ''}.`
      : 'Contact details follow once the customer confirms.',
    `Reference: ${estimate.id}`,
  ]
  return {
    to: mover.email,
    subject: `Quote request ${estimate.id.slice(0, 8)}: ${moveDetails.from ?? '?'} to ${moveDetails.to ?? '?'}`,
    body: lines.join('\n'),
  }
}

/** v1 delivery: log only. Returns the channel used so callers can report it. */
export async function deliverEmail(email: OutboundEmail): Promise<'logged'> {
  console.log(`[outbound-email] to=${email.to} subject=${JSON.stringify(email.subject)}\n${email.body}\n`)
  return 'logged'
}
