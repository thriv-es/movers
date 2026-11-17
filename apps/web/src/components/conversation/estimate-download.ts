import type { ConversationSession } from '../../lib/conversation-state'
import { conversationAnalysis } from '../../lib/conversation-state'
import { formatMoney } from '../estimate/format'
import { summaryRows } from './MoveSummary'

const escapeHtml = (value: string | number) =>
  String(value).replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  )

/** Customer-only projection. Never serialize the session, pricing breakdown, transcript, contact or photo refs. */
export function estimateDocument(session: ConversationSession): { html: string; filename: string } | null {
  if (!session.price) return null
  const price = session.price
  const analysis = conversationAnalysis(session)
  const range = `${formatMoney(price.low, price.currency)}–${formatMoney(price.high, price.currency)}`
  const rows = summaryRows(session)
    .map(({ label, value }) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('')
  const items = session.items
    .map((item) => `<li>${escapeHtml(item.type)} <strong>× ${escapeHtml(item.count)}</strong></li>`)
    .join('')
  const boxes = analysis
    ? `${analysis.estimatedBoxes.min}–${analysis.estimatedBoxes.max} boxes (photo-based estimate)`
    : 'Not yet assessed'
  const extras = (['garage', 'closets', 'appliances'] as const)
    .map(
      (key) =>
        `<li>${key}: ${session.followUps[key] === null ? 'not checked' : session.followUps[key] ? 'extra items included' : 'no extra items'}</li>`,
    )
    .join('')
  return {
    filename: `moving-estimate-${session.sessionId.replace(/[^a-z0-9-]/gi, '').slice(0, 36)}.html`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Your moving estimate</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#242424;max-width:760px;margin:48px auto;padding:0 24px}h1{font-size:32px;line-height:1.15}h2{margin-top:32px;font-size:20px}.price{font-size:36px;font-weight:700}dl>div{padding:10px 0;border-bottom:1px solid #bbb}dt{font-size:13px;color:#555}dd{margin:0}li{padding:6px 0}footer{border-top:2px solid #242424;margin-top:36px;padding-top:16px;font-size:13px}@media print{body{margin:0;max-width:none}.price{font-size:28px}}</style></head><body><p>Movers by thriv.es · Local demo estimate</p><h1>Your move, on one page.</h1><p class="price">${escapeHtml(range)}</p><p>USD demo pricing. A planning estimate, not a binding quote.</p><h2>The move</h2><dl>${rows}</dl><h2>Item list</h2><ul>${items}</ul><h2>Packing</h2><p>${escapeHtml(boxes)}</p><h2>Additional areas</h2><ul>${extras}</ul><footer>${session.scheduleResult ? 'Callback request recorded. This is not a confirmed booking; a mover must confirm availability and final scope.' : 'This estimate is not a confirmed booking. No callback is requested by downloading it.'} Your conversation remains available until you explicitly start a new session. You can print this document or save it as a PDF from your browser.</footer></body></html>`,
  }
}

export function downloadEstimate(session: ConversationSession): boolean {
  const document = estimateDocument(session)
  if (!document) return false
  const url = URL.createObjectURL(new Blob([document.html], { type: 'text/html;charset=utf-8' }))
  try {
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = document.filename
    window.document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // Allow the browser to consume the blob before revoking it. This never changes session state.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return true
}
