import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test as base, expect } from '@playwright/test'

// Immutable source corpus. All verdicts/Chat scripts are explicitly fake AI, not image ground truth.
const directory = new URL('../test/fixtures/minimax-photos/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
export const photos = manifest.photos.map(({ file }) => ({ file, path: fileURLToPath(new URL(file, directory)) }))
if (photos.length !== 10) throw new Error('Expected the unchanged ten-photo corpus')
export const endpoints = 'From 12 Main Street, Boston, MA to 9 Oak Street, Hartford, CT.'
export const access = 'Pickup is ground floor. Delivery is floor 1 with an elevator.'
export const coverage = 'No garage extras, no closet extras, no appliance extras. This covers the whole move.'

export const test = base.extend({
  page: async ({ page, context, request }, use) => {
    const external = []
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (['data:', 'blob:'].includes(url.protocol) || url.origin === 'http://127.0.0.1:5630') return route.continue()
      external.push(url.origin) // Never log contact/query/photo payloads.
      await route.abort('blockedbyclient')
    })
    await context.routeWebSocket('**/*', (socket) => {
      const url = new URL(socket.url())
      if (url.hostname !== '127.0.0.1' || url.port !== '5630') {
        external.push(url.origin)
        socket.close()
      } else socket.connectToServer()
    })
    expect((await request.post('/__e2e/reset')).ok()).toBe(true)
    await use(page)
    expect((await request.post('/__e2e/drain')).ok()).toBe(true)
    expect(external, 'Browser must never request external destinations').toEqual([])
    expect(errors, 'Browser must not raise uncaught application errors').toEqual([])
  },
})
export { expect }
export const composer = (page) => page.getByRole('textbox', { name: 'Message', exact: true })
export const feed = (page) => page.getByRole('log', { name: 'Move conversation' })
export const manifestPanel = (page) => page.getByRole('region', { name: 'Move manifest', exact: true })
export const priceButton = (page) => page.getByRole('button', { name: 'Price summary', exact: true })
export async function send(page, text) {
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/conversation')
  await composer(page).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const result = await response
  await expect(page.getByRole('button', { name: 'Cancel reply', exact: true })).toHaveCount(0)
  return result
}
export async function openPhotos(page) {
  await page.goto('/estimate')
  expect((await send(page, endpoints)).status()).toBe(200)
  expect((await session(page)).moveDetails.from).toBe('12 Main Street, Boston, MA')
  await send(page, '120 miles') // Volunteered synthetic evidence; the assistant must never ask for distance.
  await send(page, access)
}
export async function upload(page, indexes) {
  await expect(page.getByLabel('Choose from library', { exact: true })).toBeAttached()
  await expect.poll(async () => (await session(page))?.version).toBe(6)
  const before = (await session(page)).photos.length
  const analyzed = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/analyze')
  await page
    .getByLabel('Choose from library', { exact: true })
    .setInputFiles(indexes.map((index) => photos[index].path))
  await expect.poll(async () => (await session(page)).photos.length).toBe(before + indexes.length)
  const response = await analyzed
  await expect
    .poll(async () =>
      Object.values((await session(page)).operations).some(
        (op) => op.request.kind === 'analyze' && op.status === 'pending',
      ),
    )
    .toBe(false)
  await expect(page.getByRole('button', { name: 'Cancel reply', exact: true })).toHaveCount(0)
  return response
}
export async function updateSession(page) {
  const update = page.getByRole('button', { name: 'Update this session', exact: true })
  if (await update.count()) await update.click()
}
export async function expectPriceBlocked(page) {
  await updateSession(page)
  await priceButton(page).click()
  await expect(page.getByRole('button', { name: 'Book this move', exact: true })).toBeDisabled()
  expect((await session(page)).price).toBeNull()
  await updateSession(page)
}
export async function accept(page) {
  await page.getByText('Review suggested changes', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Accept suggestion', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Accept suggestion', exact: true }).click()
}
export async function propose(page, command) {
  // Provider-level script only; real route derives latest-message facts for a stated detail correction.
  // Non-factual suggestions stay pending and require explicit acceptance. Never fulfill API responses.
  expect((await page.request.post('/__e2e/scenario', { data: { name: 'normal', commands: [command] } })).ok()).toBe(
    true,
  )
  const wording =
    command.type === 'details.patch'
      ? Object.entries(command.patch)
          .map(([field, value]) => `${field}: ${value}`)
          .join('. ')
      : 'Synthetic fake-AI proposed correction for explicit review.'
  expect((await send(page, wording)).status()).toBe(200)
  if (command.type === 'details.patch') {
    expect((await session(page)).pendingProposals).toHaveLength(0)
    expect((await session(page)).moveDetails).toMatchObject(command.patch)
    await updateSession(page)
  } else {
    expect((await session(page)).pendingProposals).toHaveLength(1)
    await accept(page)
  }
  expect((await page.request.post('/__e2e/scenario', { data: { name: 'normal' } })).ok()).toBe(true)
}
export async function review(page, { duplicates }) {
  expect((await session(page)).analysis.possibleDuplicates).toEqual(
    duplicates.map(({ item, count }) => ({ item, count })),
  )
  for (const { item, count, resolution } of duplicates) {
    expect(count).toBeGreaterThan(1)
    expect((await session(page)).items.find((entry) => entry.type === item)).toEqual({ type: item, count })
    await propose(page, { type: 'duplicate.resolve', itemType: item, resolution })
    expect((await session(page)).items.find((entry) => entry.type === item)).toEqual({
      type: item,
      count: resolution === 'same' ? 1 : count,
    })
  }
  expect((await session(page)).duplicateResolutions).toEqual(
    Object.fromEntries(duplicates.map(({ item, resolution }) => [item, resolution])),
  )
  expect((await send(page, coverage)).status()).toBe(200)
}
export async function ready(page) {
  await openPhotos(page)
  expect((await upload(page, [2])).status()).toBe(200)
  await review(page, { duplicates: [] })
  await expect(page.getByRole('dialog', { name: 'Your move estimate' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Book this move' })).toBeEnabled()
}
export async function fillContact(page) {
  await page.getByLabel('Your name', { exact: true }).fill('Synthetic Customer')
  await page.getByLabel('Email', { exact: true }).fill('synthetic@example.invalid')
  await page.getByLabel('Phone', { exact: true }).fill('5550100')
  await page.getByLabel('Preferred move date', { exact: true }).fill('2027-01-11')
}
export async function booking(page) {
  await page.getByRole('button', { name: 'Book this move', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Book your move' })).toBeVisible()
  await fillContact(page)
}
export async function state(request) {
  return (await request.get('/__e2e/state')).json()
}
export async function gate(request, key, release = false) {
  expect((await request.post('/__e2e/gate', { data: { key, release } })).ok()).toBe(true)
}
export async function entered(request, key) {
  await expect.poll(async () => (await state(request)).entered.includes(key)).toBe(true)
}
export function writes(data) {
  return data.requests.filter(
    (entry) =>
      ['POST', 'PATCH'].includes(entry.method) &&
      ['/api/price', '/api/estimates', '/api/quote-requests'].some((path) => entry.path.startsWith(path)),
  )
}
export const commercial = (data) => writes(data).filter((entry) => entry.path !== '/api/price')
export async function session(page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('movers.estimate')))
}
