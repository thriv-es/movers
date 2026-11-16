import { test, expect } from './fixtures.mjs'

// This is emulation, not a physical mobile keyboard or operating-system zoom test.
test('simulated visual-viewport keyboard resize and Chromium pinch zoom retain reachable controls', async ({
  page,
  context,
  browser,
}) => {
  console.log(`Browser release: ${browser.version()}`)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/estimate')
  const log = page.getByRole('log', { name: 'Move conversation' })
  await expect(log).toContainText('Synthetic offline assistant reply')
  const panel = page.getByRole('region', { name: 'Chat about your move' })
  const initial = await panel.evaluate((node) => node.getBoundingClientRect().height)
  await page.evaluate(() => {
    const viewport = window.visualViewport
    if (!viewport) throw new Error('Chromium VisualViewport is required')
    Object.defineProperty(viewport, 'height', { configurable: true, get: () => 644 })
    viewport.dispatchEvent(new Event('resize'))
  })
  await expect
    .poll(async () => panel.evaluate((node) => node.getBoundingClientRect().height))
    .toBeLessThan(initial - 150)
  const composerBottom = await page
    .getByRole('textbox', { name: 'Your answer' })
    .evaluate((node) => node.getBoundingClientRect().bottom)
  expect(composerBottom).toBeLessThan(644)
  await page.evaluate(() => {
    const viewport = window.visualViewport
    if (!viewport) throw new Error('Chromium VisualViewport is required')
    Reflect.deleteProperty(viewport, 'height')
    viewport.dispatchEvent(new Event('resize'))
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 })
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale)).toBe(1.5)
  const input = page.getByRole('textbox', { name: 'Your answer' })
  await input.scrollIntoViewIfNeeded()
  await expect(input).toBeInViewport()
  await input.fill('Zoomed synthetic answer')
  // CDP pinch zoom does not provide trustworthy Playwright pointer coordinates; use native keyboard activation.
  await input.press('Tab')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(log).toContainText('Zoomed synthetic answer')
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
  await cdp.detach()
})

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  // Catches fixed transcript height, page-scroll following, and stealing a scrolled-up reader's position.
  test(`${viewport.name}: chat fills viewport, follows growth and preserves a reader above the bottom`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await request.post('/__e2e/scenario', { data: { name: 'normal', chatDelay: 750 } })
    await page.goto('/estimate')
    const log = page.getByRole('log', { name: 'Move conversation' })
    await expect(log).toContainText('Synthetic offline assistant reply')
    const panel = page.getByRole('region', { name: 'Chat about your move' })
    await expect
      .poll(async () => panel.evaluate((node) => Math.abs(window.innerHeight - node.getBoundingClientRect().bottom)))
      .toBeLessThan(32)
    const input = page.getByRole('textbox', { name: 'Your answer' })
    await expect(input).toBeInViewport()
    const geometry = await panel.evaluate((node) => ({
      panelTop: node.getBoundingClientRect().top,
      panelBottom: node.getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight,
      transcriptHeight: node.querySelector('[role="log"]')?.getBoundingClientRect().height,
    }))
    await test
      .info()
      .attach(`${viewport.name}-geometry.json`, { body: JSON.stringify(geometry), contentType: 'application/json' })
    console.log(`${viewport.name} geometry: ${JSON.stringify(geometry)}`)
    await expect(page.getByRole('button', { name: 'Fill in a form instead' })).toBeInViewport()
    await expect
      .poll(async () => log.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThan(3)
    // One existing bubble grows without adding messages: verifies the real ResizeObserver, not message-count effects.
    await log
      .locator('[data-role="assistant"]')
      .last()
      .evaluate((node) => {
        node.append(document.createTextNode(' Existing message growth. '.repeat(80)))
      })
    await expect
      .poll(async () => log.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThan(3)
    await input.fill('Synthetic local move details')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(log).toContainText('Thinking...')
    await expect
      .poll(async () => log.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThan(3)
    // Scroll while the real /chat request is pending; the arriving reply must not move the reader.
    await log.evaluate((node) => {
      node.scrollTop = 0
      node.dispatchEvent(new Event('scroll'))
    })
    await expect(log).not.toContainText('Thinking...')
    await expect.poll(async () => log.evaluate((node) => node.scrollTop)).toBeLessThan(3)
    await log
      .locator('[data-role="assistant"]')
      .last()
      .evaluate((node) => {
        node.append(document.createTextNode(' More existing content. '.repeat(60)))
      })
    await expect.poll(async () => log.evaluate((node) => node.scrollTop)).toBeLessThan(3)
    // Sending your own message resumes following, even from the top.
    await input.fill('One more synthetic answer')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(log).not.toContainText('Thinking...')
    await expect
      .poll(async () => log.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
      .toBeLessThan(3)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await page.getByRole('complementary', { name: 'What we know so far' }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('complementary', { name: 'What we know so far' })).toBeInViewport()
  })
}

test('short mobile viewport keeps composer and actions reachable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 })
  await page.goto('/estimate')
  await expect(page.getByRole('log', { name: 'Move conversation' })).toContainText('Synthetic offline assistant reply')
  const input = page.getByRole('textbox', { name: 'Your answer' })
  await input.scrollIntoViewIfNeeded()
  await expect(input).toBeInViewport()
  await page.getByRole('button', { name: 'Fill in a form instead' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Fill in a form instead' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
