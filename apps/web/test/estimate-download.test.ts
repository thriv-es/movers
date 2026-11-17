import { expect, it } from 'vitest'
import { createConversationSession } from '../src/lib/conversation-state'
const exporterPath = '../src/components/conversation/estimate-download'

it('downloads a printable price and item summary without private or internal data, with escaped customer text', async () => {
  const exporter = await import(/* @vite-ignore */ exporterPath).catch(() => null)
  expect(exporter).not.toBeNull()
  if (!exporter) return
  const session = createConversationSession()
  session.moveDetails.from = '<img src=x onerror=alert(1)> 12 Main Street'
  session.moveDetails.to = '9 Oak Street, Hartford'
  session.items = [{ type: '<script>bad()</script> chair', count: 2 }]
  session.price = {
    currency: 'USD',
    total: 650,
    low: 585,
    high: 715,
    breakdown: { PRIVATE_TARIFF: 650 },
    explanation: 'PRIVATE_FORMULA',
  }
  session.photos = [{ id: 'photo-one', url: 'https://private.invalid/private-image', receipt: 'PRIVATE_RECEIPT' }]
  session.messages = [{ id: 'chat', role: 'user', content: 'PRIVATE_TRANSCRIPT' }]
  session.contact = {
    name: 'PRIVATE_CONTACT',
    email: 'private@example.invalid',
    phone: 'PRIVATE_PHONE',
    requestedDate: '2027-01-11',
  }
  const result = exporter.estimateDocument(session)
  expect(result).not.toBeNull()
  const doc = new DOMParser().parseFromString(result?.html ?? '', 'text/html')
  expect(doc.body.textContent).toContain('$585')
  expect(doc.body.textContent).toContain('$715')
  expect(doc.body.textContent).toContain('9 Oak Street, Hartford')
  expect(doc.body.textContent).toContain('<script>bad()</script> chair')
  expect(doc.querySelectorAll('script, img, iframe, a, form')).toHaveLength(0)
  expect(result?.html).not.toMatch(/PRIVATE_|private\.invalid|private@example/)
  expect(result?.filename).toMatch(/^moving-estimate-[a-z0-9-]+\.html$/)
  expect(doc.body.textContent).toContain('not a confirmed booking')
})
it('does not create an estimate download before a real price exists', async () => {
  const exporter = await import(/* @vite-ignore */ exporterPath).catch(() => null)
  expect(exporter).not.toBeNull()
  if (!exporter) return
  expect(exporter.estimateDocument(createConversationSession())).toBeNull()
})
