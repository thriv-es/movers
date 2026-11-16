import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test as base, expect } from '@playwright/test'

const directory = new URL('../test/fixtures/minimax-photos/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'))
export const photos = manifest.photos.map(({ file }) => ({ file, path: fileURLToPath(new URL(file, directory)) }))
if (photos.length !== 10) throw new Error('Expected the unchanged ten-photo corpus')

export const test = base.extend({
  page: async ({ page, context, request }, use) => {
    const external = []
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (['data:', 'blob:'].includes(url.protocol) || url.origin === 'http://127.0.0.1:5630') {
        return route.continue()
      }
      external.push(url.href)
      await route.abort('blockedbyclient')
    })
    await context.routeWebSocket('**/*', (socket) => {
      const url = new URL(socket.url())
      if (url.hostname !== '127.0.0.1' || url.port !== '5630') {
        external.push(url.href)
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

export async function openPhotos(page) {
  await page.goto('/estimate')
  await send(page, 'from Tel Aviv to Raanana on 1.1.2027')
  await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('Tel Aviv')
  await send(page, '15 miles')
  await page.getByRole('button', { name: 'Confirm move details', exact: true }).click()
}

export async function upload(page, indexes) {
  const before = (await session(page)).photos.length
  await page
    .getByLabel('Choose from library', { exact: true })
    .setInputFiles(indexes.map((index) => photos[index].path))
  await expect.poll(async () => (await session(page)).photos.length).toBe(before + indexes.length)
  await expect(page.getByRole('button', { name: /^Analyse (again|\d+ photos?)$/ })).toBeEnabled()
}

export async function analyze(page) {
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/analyze')
  await page.getByRole('button', { name: /^Analyse (again|\d+ photos?)$/ }).click()
  return response
}

export const priceButton = (page) =>
  page.getByRole('button', { name: 'Confirm inventory and get estimate', exact: true })
export const manifestPanel = (page) => page.getByRole('region', { name: 'Move manifest', exact: true })
export async function send(page, text) {
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/conversation')
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const result = await response
  await expect(page.getByRole('button', { name: 'Cancel reply', exact: true })).toHaveCount(0)
  return result
}
export async function review(page, { duplicates }) {
  // Every caller declares whether duplicate coverage is expected; zero actions can never silently claim coverage.
  expect((await session(page)).analysis.possibleDuplicates).toEqual(
    duplicates.map(({ item, count }) => ({ item, count })),
  )
  await expect(page.getByRole('button', { name: /^(Same|Different) / })).toHaveCount(duplicates.length * 2)
  for (const { item, count, resolution } of duplicates) {
    expect(count).toBeGreaterThan(1)
    const before = (await session(page)).items.find((entry) => entry.type === item)
    expect(before).toEqual({ type: item, count })
    await expect(
      page.getByText(`Is ${item} the same item seen from different angles, or different items?`, { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: `${resolution === 'same' ? 'Same' : 'Different'} ${item}`, exact: true })
      .click()
    expect((await session(page)).items.find((entry) => entry.type === item)).toEqual({
      type: item,
      count: resolution === 'same' ? 1 : count,
    })
  }
  expect((await session(page)).duplicateResolutions).toEqual(
    Object.fromEntries(duplicates.map(({ item, resolution }) => [item, resolution])),
  )
  await expect(page.getByRole('button', { name: /^(Same|Different) / })).toHaveCount(0)
  for (const name of ['Garage', 'Closets', 'Appliances'])
    await page.getByRole('group', { name, exact: true }).getByRole('button', { name: 'No', exact: true }).click()
  await page
    .getByRole('group', { name: 'Does this cover the whole move?' })
    .getByRole('button', { name: 'Yes', exact: true })
    .click()
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

export async function session(page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('movers.estimate')))
}
