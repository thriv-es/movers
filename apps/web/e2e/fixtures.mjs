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
    expect(external, 'Browser must never request external destinations').toEqual([])
    expect(errors, 'Browser must not raise uncaught application errors').toEqual([])
  },
})
export { expect }

export async function openPhotos(page) {
  await page.goto('/estimate')
  await page.getByRole('button', { name: 'Fill in a form instead' }).click()
  await page.getByLabel('Moving from', { exact: true }).fill('100 Test Street, Boston, MA')
  await page.getByLabel('Moving to', { exact: true }).fill('200 Fixture Lane, Cambridge, MA')
  await page.getByLabel('Distance (miles)').fill('15')
  await page.getByRole('button', { name: 'Continue to photos' }).click()
}

export async function upload(page, indexes) {
  await page
    .getByLabel('Choose from library', { exact: true })
    .setInputFiles(indexes.map((index) => photos[index].path))
  await expect(
    page.getByRole('button', {
      name: `Analyse ${indexes.length} photo${indexes.length === 1 ? '' : 's'}`,
      exact: true,
    }),
  ).toBeEnabled()
}

export async function analyze(page) {
  const response = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/analyze')
  await page.getByRole('button', { name: /^Analyse \d+ photos?$/ }).click()
  return response
}

export async function session(page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('movers.estimate')))
}
