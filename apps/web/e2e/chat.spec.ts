import {
  test,
  expect,
  send,
  session,
  state,
  writes,
  gate,
  entered,
  openPhotos,
  upload,
  propose,
  accept,
  composer,
  feed,
  manifestPanel,
  endpoints,
} from './fixtures.mjs'
const pending = (page) => page.getByRole('button', { name: 'Cancel reply', exact: true })

test('grounded combined answer applies once, later accepted correction reaches next request and read-only manifest', async ({
  page,
  request,
}) => {
  await page.goto('/estimate')
  await expect(feed(page)).toContainText('Where are you moving from and to?')
  expect(writes(await state(request))).toEqual([])
  const before = await session(page)
  const response = await send(page, endpoints)
  expect(response.status()).toBe(200)
  await expect(feed(page)).not.toContainText(/how many miles|how far/i)
  const after = await session(page)
  expect(after.revision).toBe(before.revision + 1)
  expect(after.moveDetails).toMatchObject({
    from: '12 Main Street, Boston, MA',
    to: '9 Oak Street, Hartford, CT',
    date: null,
    distanceMiles: null,
    originFloor: null,
    destinationFloor: null,
    originElevator: null,
    destinationElevator: null,
  })
  expect(after.detailsConfirmed).toBe(false)
  await expect(manifestPanel(page)).toContainText('9 Oak Street, Hartford, CT')
  await propose(page, { type: 'details.patch', patch: { from: '11 Replacement Street, Boston, MA' } })
  const current = await send(page, 'What is next?')
  expect(current.request().postDataJSON().snapshot.moveDetails.from).toBe('11 Replacement Street, Boston, MA')
  await page.reload()
  await expect(manifestPanel(page)).toContainText('11 Replacement Street, Boston, MA')
  expect(writes(await state(request))).toEqual([])
})

for (const edited of [false, true]) {
  test(`failed reply retry ${edited ? 'after photo edit requires Accept' : 'unchanged keeps original Send authority'}`, async ({
    page,
    request,
  }) => {
    if (edited) {
      await openPhotos(page)
      await upload(page, [8])
    } else await page.goto('/estimate')
    await request.post('/__e2e/scenario', { data: { name: 'normal', conversationFailure: true } })
    const original = edited ? 'Actually pickup is floor 2, no elevator.' : endpoints
    expect((await send(page, original)).status()).toBe(502)
    await expect(page.getByRole('button', { name: 'Retry reply' })).toBeVisible()
    if (edited) await page.getByRole('button', { name: 'Keep photo 1' }).click()
    const revision = (await session(page)).revision
    await request.post('/__e2e/scenario', { data: { name: 'normal' } })
    const retried = page.waitForResponse((response) => response.url().endsWith('/api/conversation'))
    await page.getByRole('button', { name: 'Retry reply' }).click()
    const response = await retried
    expect(response.status()).toBe(200)
    await expect(pending(page)).toHaveCount(0)
    expect(response.request().postDataJSON().snapshot.revision).toBe(revision)
    expect(response.request().postDataJSON().messages.at(-1).content).toBe(original)
    if (edited) {
      expect((await session(page)).moveDetails.originFloor).toBe(0)
      await accept(page)
      expect((await session(page)).moveDetails.originFloor).toBe(2)
    } else expect((await session(page)).moveDetails.from).toBe('12 Main Street, Boston, MA')
    expect(
      (await session(page)).messages.filter((message) => message.role === 'user' && message.content === original),
    ).toHaveLength(1)
    expect(writes(await state(request))).toEqual([])
  })
}

test('stale in-flight reply is rejected and retry uses current revision without reauthorizing an old answer', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  await upload(page, [8])
  await gate(request, 'conversation')
  await composer(page).fill('Actually pickup is floor 2, no elevator.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await entered(request, 'conversation')
  await page.getByRole('button', { name: 'Keep photo 1' }).click()
  const revision = (await session(page)).revision
  await gate(request, 'conversation', true)
  await expect(pending(page)).toHaveCount(0)
  expect((await session(page)).moveDetails.originFloor).toBe(0)
  expect((await session(page)).pendingProposals).toEqual([])
  await expect(page.getByRole('alert')).toContainText('stale reply was not applied')
  await page.getByRole('button', { name: 'Retry reply' }).click()
  await expect(pending(page)).toHaveCount(0)
  expect((await session(page)).revision).toBe(revision)
  expect((await session(page)).moveDetails.originFloor).toBe(0)
  await accept(page)
  expect((await session(page)).moveDetails.originFloor).toBe(2)
  expect(writes(await state(request))).toEqual([])
})

test('ungrounded review/item proposals require Accept; original price intent opens only a read-only summary', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  await upload(page, [2])
  for (const command of [
    { type: 'item.add', item: { type: 'fixture lamp', count: 1 } },
    { type: 'followUp.answer', key: 'garage', answer: false },
    { type: 'coverage.answer', answer: true },
  ]) {
    await request.post('/__e2e/scenario', { data: { name: 'normal', commands: [command] } })
    const before = await session(page)
    await send(page, 'Synthetic fake-AI suggestion requiring explicit review.')
    const proposed = await session(page)
    expect(proposed.items).toEqual(before.items)
    expect(proposed.followUps).toEqual(before.followUps)
    expect(proposed.wholeMoveCovered).toBe(before.wholeMoveCovered)
    await expect(page.getByRole('button', { name: 'Accept suggestion' })).toHaveCount(0)
    await accept(page)
    expect(writes(await state(request))).toEqual([])
  }
  expect((await session(page)).items.some((item) => item.type === 'fixture lamp')).toBe(true)
  await request.post('/__e2e/scenario', {
    data: { name: 'normal', commands: [{ type: 'request.action', action: 'price' }] },
  })
  await send(page, 'Please show my price summary.')
  await expect(page.getByRole('dialog', { name: 'Your move estimate' })).toContainText('We won’t guess a price')
  expect(writes(await state(request))).toEqual([])
})

for (const viewport of [
  { name: 'user desktop', width: 917, height: 987 },
  { name: 'wide desktop', width: 1440, height: 1000 },
]) {
  test(`${viewport.name}: independent long manifest/chat columns and preserved readers`, async ({ page, request }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await openPhotos(page)
    await upload(page, [2])
    const log = feed(page)
    const panel = page.locator('.conv-shell > .conv-data-scroll')
    const anchor = log.locator('[data-conversation-anchor="true"]')
    await expect(anchor).toBeInViewport({ ratio: 0.99 })
    await expect(composer(page)).toBeInViewport({ ratio: 1 })
    await expect(manifestPanel(page)).toContainText('12 Main Street')
    for (let index = 0; index < 16; index++)
      await propose(page, { type: 'item.add', item: { type: `synthetic inventory item ${index}`, count: 1 } })
    for (let index = 0; index < 5; index++)
      await send(page, `History ${index}: ${'Synthetic history words. '.repeat(60)}`)
    await expect(anchor).toBeInViewport({ ratio: 0.99 })
    await expect.poll(() => panel.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(200)
    const outer = await page.evaluate(() => window.scrollY)
    const feedTop = await log.evaluate((node) => node.scrollTop)
    await panel.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    expect(await log.evaluate((node) => node.scrollTop)).toBe(feedTop)
    const panelTop = await panel.evaluate((node) => node.scrollTop)
    await log.evaluate((node) => {
      node.scrollTop = 0
      node.dispatchEvent(new Event('scroll'))
    })
    await composer(page).fill('Unsent reader draft')
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBe(0)
    expect(await panel.evaluate((node) => node.scrollTop)).toBe(panelTop)
    await composer(page).fill('Rerender without a legacy card stack')
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBe(0)
    await send(page, 'Explicit Send resumes following')
    await expect(anchor).toBeInViewport({ ratio: 0.99 })
    expect(await page.evaluate(() => window.scrollY)).toBe(outer)
    expect(writes(await state(request))).toEqual([])
  })
}

test('mobile read-only right drawer traps focus and Escape restores trigger without replacing chat/draft', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/estimate')
  const input = await composer(page).elementHandle()
  await send(page, endpoints)
  const trigger = page.getByRole('button', { name: 'Open move manifest', exact: true })
  await expect(trigger).toContainText('40% · What we know')
  await composer(page).fill('Drawer-safe draft')
  await trigger.click()
  const drawer = page.getByRole('dialog', { name: 'Your move so far', exact: true })
  await expect(drawer).toBeVisible()
  const rect = await drawer.boundingBox()
  expect(rect.x + rect.width).toBeCloseTo(390, 0)
  expect(rect.x).toBeGreaterThanOrEqual(0)
  await expect(page.getByRole('button', { name: 'Back to chat' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Tab')
  expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true)
  await expect(drawer.getByRole('textbox')).toHaveCount(0)
  await expect(drawer).toContainText('12 Main Street')
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(composer(page)).toHaveValue('Drawer-safe draft')
  expect(await input.evaluate((node) => node === document.querySelector('#conversation-message'))).toBe(true)
  await expect(feed(page)).toContainText(endpoints)
  expect(writes(await state(request))).toEqual([])
})

// Emulated VisualViewport and pinch zoom, not a claim about a physical OS keyboard.
test('short height, simulated keyboard and pinch zoom keep native-photo trigger and composer reachable', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 500 })
  await page.goto('/estimate')
  await expect(feed(page).locator('[data-conversation-anchor="true"]')).toBeInViewport()
  await expect(composer(page)).toBeInViewport({ ratio: 1 })
  await expect(page.getByText('Add photos', { exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const panel = page.getByRole('region', { name: 'Chat about your move' })
  const initial = await panel.evaluate((node) => node.getBoundingClientRect().height)
  await page.evaluate(() => {
    const viewport = window.visualViewport
    Object.defineProperty(viewport, 'height', { configurable: true, get: () => 350 })
    viewport.dispatchEvent(new Event('resize'))
  })
  await expect.poll(() => panel.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(initial - 100)
  expect(await composer(page).evaluate((node) => node.getBoundingClientRect().bottom)).toBeLessThan(350)
  await composer(page).fill('Emulated keyboard answer')
  await page.evaluate(() => {
    const viewport = window.visualViewport
    Reflect.deleteProperty(viewport, 'height')
    viewport.dispatchEvent(new Event('resize'))
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 })
  await expect.poll(() => page.evaluate(() => visualViewport?.scale)).toBe(1.5)
  await composer(page).scrollIntoViewIfNeeded()
  await expect(composer(page)).toBeInViewport()
  await composer(page).focus()
  await composer(page).press('Tab')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(feed(page)).toContainText('Emulated keyboard answer')
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
  await cdp.detach()
})

test('fresh migrated runtime exposes actual D1 tables/routes, isolated seed and real R2 upload', async ({
  page,
  request,
}) => {
  const health = await (await request.get('/__e2e/health')).json()
  expect(health.fakeAI).toBe(true)
  expect(health.migrations).toEqual(['0001', '0002', '0003'])
  expect(health.tables).toEqual(
    expect.arrayContaining(['estimates', 'movers', 'quote_requests', 'photo_receipts', 'ai_settings']),
  )
  await request.post('/__e2e/reset', { data: { seed: false } })
  expect((await state(request)).movers).toBe(0)
  expect((await request.get('/api/estimates/00000000-0000-4000-8000-000000000000')).status()).toBe(404)
  expect((await request.get('/api/ai-status')).status()).toBe(200)
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => request.get('/api/movers')))
  const statuses = concurrent.map((response) => response.status())
  expect(statuses.every((status) => [200, 500].includes(status))).toBe(true)
  expect(statuses).toContain(200)
  await openPhotos(page)
  expect((await upload(page, [2])).status()).toBe(200)
  expect((await state(request)).receipts).toBe(1)
})
