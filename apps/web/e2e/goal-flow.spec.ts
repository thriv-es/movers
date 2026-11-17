import { readFile } from 'node:fs/promises'
import { test, expect, send, session, state, photos, gate, entered } from './fixtures.mjs'

const manifest = (page) => page.getByRole('region', { name: 'Move manifest', exact: true })
const commercial = (data) =>
  data.requests.filter(
    (entry) =>
      ['POST', 'PATCH'].includes(entry.method) &&
      ['/api/estimates', '/api/quote-requests'].some((path) => entry.path.startsWith(path)),
  )
async function attach(page, indexes = [2]) {
  await page
    .getByLabel('Choose from library', { exact: true })
    .setInputFiles(indexes.map((index) => photos[index].path))
  await expect.poll(async () => (await session(page)).analysis !== null).toBe(true)
  await expect(page.getByRole('button', { name: 'Cancel reply', exact: true })).toHaveCount(0)
}
async function ready(page) {
  await page.goto('/estimate')
  await send(page, 'From 12 Main Street, Boston, MA to 9 Oak Street, Hartford, CT.')
  await send(page, '120 miles') // Volunteered fixture evidence; the assistant must never request it.
  await send(page, 'Pickup is ground floor. Delivery is floor 1 with an elevator.')
  await attach(page)
  await send(page, 'No garage extras, no closet extras, no appliance extras. This covers the whole move.')
  await expect(page.getByRole('dialog', { name: 'Your move estimate' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Book this move' })).toBeEnabled()
}
async function fillContact(page) {
  await page.getByLabel('Your name', { exact: true }).fill('Synthetic Customer')
  await page.getByLabel('Email', { exact: true }).fill('synthetic@example.invalid')
  await page.getByLabel('Phone', { exact: true }).fill('5550100')
  await page.getByLabel('Preferred move date', { exact: true }).fill('2027-01-11')
}

test('fresh chat starts with one AI question and a quiet, form-free manifest', async ({ page, request }) => {
  await page.goto('/estimate')
  await expect(page.getByRole('log')).toContainText('Where are you moving from and to?')
  await expect(page.getByRole('progressbar', { name: 'Move information completeness' })).toHaveAttribute(
    'aria-valuenow',
    '0',
  )
  await expect(manifest(page).getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveCount(3)
  expect(commercial(await state(request))).toEqual([])
})
test('early price summary shows missing essentials, preserves history and draft, and never prices or saves', async ({
  page,
  request,
}) => {
  await page.goto('/estimate')
  await send(page, 'From 12 Main Street, Boston, MA to 9 Oak Street, Hartford, CT.')
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Keep this unsent draft')
  const before = await session(page)
  await page.getByRole('button', { name: 'Price summary', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Your move estimate' })).toContainText('We won’t guess a price')
  await expect(page.getByRole('button', { name: 'Book this move' })).toBeDisabled()
  await page.getByRole('button', { name: 'Update this session' }).click()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Keep this unsent draft')
  await expect(page.getByRole('log')).toContainText(before.messages[0].content)
  expect((await session(page)).sessionId).toBe(before.sessionId)
  expect((await state(request)).requests.filter((entry) => entry.path === '/api/price')).toEqual([])
  expect(commercial(await state(request))).toEqual([])
})
test('photo upload runs real analysis route and feeds its structured inventory into the next conversation', async ({
  page,
  request,
}) => {
  await page.goto('/estimate')
  await send(page, 'From 12 Main Street, Boston, MA to 9 Oak Street, Hartford, CT.')
  await attach(page)
  await expect(manifest(page)).toContainText('desk')
  await expect(manifest(page)).toContainText('Estimated packing boxes')
  const data = await state(request)
  expect(data.calls).toHaveLength(1)
  expect(data.conversationCalls).toBeGreaterThanOrEqual(2)
  expect(data.conversationContexts.some((context) => context.hasAnalysis && context.inventoryCount > 0)).toBe(true)
  expect(commercial(data)).toEqual([])
  const before = await session(page)
  await page.reload()
  await expect(manifest(page)).toContainText('desk')
  expect((await session(page)).messages).toEqual(before.messages)
  expect((await state(request)).calls).toHaveLength(1)
})
test('90-percent-ready summary is read-only; booking and download preserve the same session', async ({
  page,
  request,
}) => {
  await ready(page)
  const before = await session(page)
  expect(commercial(await state(request))).toEqual([])
  await expect(page.getByRole('dialog')).not.toContainText('Synthetic transport')
  await expect(page.getByRole('dialog')).not.toContainText('650')
  await page.getByRole('button', { name: 'Book this move' }).click()
  await expect(page.getByRole('dialog', { name: 'Book your move' })).toBeVisible()
  expect(commercial(await state(request))).toEqual([])
  await fillContact(page)
  await page.getByRole('button', { name: 'Request a callback' }).click()
  await expect(page.getByRole('heading', { name: 'Callback request recorded' })).toBeVisible()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download estimate and item list' }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toMatch(/^moving-estimate-.*\.html$/)
  const document = await readFile(await download.path(), 'utf8')
  expect(document).toContain('desk')
  expect(document).toContain('12 Main Street, Boston, MA')
  expect(document).toContain('9 Oak Street, Hartford, CT')
  expect(document).not.toMatch(/Synthetic transport|synthetic@example|5550100|receipt|data:image|<script/i)
  expect((await session(page)).sessionId).toBe(before.sessionId)
  expect((await session(page)).messages).toEqual(before.messages)
  const data = await state(request)
  expect(data.estimates).toBe(1)
  expect(data.quotes).toBe(0)
  expect(commercial(data)).toHaveLength(2)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Start a new session' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(async () => (await session(page)).messages.length).toBe(0)
  expect((await session(page)).sessionId).not.toBe(before.sessionId)
})
test('updating access retains image inventory and previous answers, and never submits a lead', async ({
  page,
  request,
}) => {
  await ready(page)
  const before = await session(page)
  await page.getByRole('button', { name: 'Update this session' }).click()
  await send(page, 'Actually pickup is floor 2, no elevator.')
  await expect.poll(async () => (await session(page)).moveDetails.originFloor).toBe(2)
  const after = await session(page)
  expect(after.items).toEqual(before.items)
  expect(after.followUps).toEqual(before.followUps)
  expect(after.analysis).toEqual(before.analysis)
  expect(after.messages.some((message) => message.content === before.messages[0].content)).toBe(true)
  expect(commercial(await state(request))).toEqual([])
})
test('analysis failure is durable and retry is explicit rather than an automatic loop', async ({ page, request }) => {
  await page.goto('/estimate')
  await send(page, 'From 12 Main Street, Boston, MA to 9 Oak Street, Hartford, CT.')
  await request.post('/__e2e/scenario', { data: { name: 'provider-failure' } })
  await page.getByLabel('Choose from library', { exact: true }).setInputFiles(photos[2].path)
  await expect(page.getByRole('button', { name: 'Retry analyze' })).toBeVisible()
  const failed = await state(request)
  await page.waitForTimeout(500)
  expect((await state(request)).calls).toHaveLength(failed.calls.length)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Retry analyze' })).toBeVisible()
  await request.post('/__e2e/scenario', { data: { name: 'normal' } })
  await page.getByRole('button', { name: 'Retry analyze' }).click()
  await expect.poll(async () => (await session(page)).analysis !== null).toBe(true)
  expect(commercial(await state(request))).toEqual([])
})
test('lost callback response blocks blind retry and reset across reload', async ({ page, request }) => {
  await ready(page)
  await page.getByRole('button', { name: 'Book this move' }).click()
  await fillContact(page)
  await gate(request, 'after:POST /api/estimates')
  await page.getByRole('button', { name: 'Request a callback' }).click()
  await entered(request, 'after:POST /api/estimates')
  await page.reload()
  await page.getByRole('button', { name: 'Price summary', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start a new session' })).toBeDisabled()
  expect((await state(request)).estimates).toBe(1)
  expect((await state(request)).quotes).toBe(0)
})
test('summary and mobile manifest retain readable ink text in a dark application theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/estimate')
  await page.getByRole('button', { name: 'Price summary', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Your move estimate' })).toHaveCSS('color', 'rgb(18, 18, 26)')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 700 })
  await page.getByRole('button', { name: 'Open move manifest', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Your move so far' })).toHaveCSS('color', 'rgb(18, 18, 26)')
})
test('mobile summary Escape and update return focus to the same composer without replacing the thread', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await page.goto('/estimate')
  await send(page, 'From 12 Main Street, Boston, MA to 9 Oak Street, Hartford, CT.')
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('My draft')
  await page.getByRole('button', { name: 'Price summary', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('My draft')
  await expect(page.getByRole('log')).toContainText('12 Main Street')
})
