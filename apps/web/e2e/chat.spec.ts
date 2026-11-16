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
  analyze,
  review,
  priceButton,
} from './fixtures.mjs'

const input = (page) => page.getByRole('textbox', { name: 'Message', exact: true })
const log = (page) => page.getByRole('log', { name: 'Move conversation' })
const pending = (page) => page.getByRole('button', { name: 'Cancel reply', exact: true })

test('combined answer updates one revision, contextual street retains city, explicit replacement drops city', async ({
  page,
  request,
}) => {
  await page.goto('/estimate')
  await expect(log(page)).toContainText('Where are you moving from and to?')
  expect(writes(await state(request))).toEqual([])
  const before = await session(page)
  const response = await send(page, 'from Tel Aviv to Raanana on 1.1.2027')
  expect(response.status()).toBe(200)
  expect((await response.json()).reply).toMatch(/photo/i)
  await expect(log(page)).not.toContainText(/how many miles|how far/i)
  const after = await session(page)
  expect(after.revision).toBe(before.revision + 1)
  expect(after.moveDetails).toMatchObject({
    from: 'Tel Aviv',
    to: 'Raanana',
    date: '2027-01-01',
    distanceMiles: null,
    originFloor: null,
    destinationFloor: null,
    originElevator: null,
    destinationElevator: null,
  })
  expect(after.detailsConfirmed).toBe(false)
  await expect(page.getByLabel('Moving to', { exact: true })).toHaveValue('Raanana')
  await send(page, 'origin street: 12 Main Street')
  await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('12 Main Street, Tel Aviv')
  await send(page, 'origin address: 9 Oak Street, Haifa')
  await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('9 Oak Street, Haifa')
  await page.getByLabel('Moving to', { exact: true }).fill('Panel destination')
  const current = await send(page, 'What is next?')
  expect(current.request().postDataJSON().snapshot.moveDetails.to).toBe('Panel destination')
  await page.reload()
  await expect(page.getByLabel('Moving to', { exact: true })).toHaveValue('Panel destination')
  expect(writes(await state(request))).toEqual([])
})

for (const edited of [false, true]) {
  test(`failed conversation retry ${edited ? 'after panel edit requires Accept' : 'same revision keeps Send authorization'}`, async ({
    page,
    request,
  }) => {
    await page.goto('/estimate')
    await request.post('/__e2e/scenario', { data: { name: 'normal', conversationFailure: true } })
    expect((await send(page, 'from Tel Aviv to Raanana on 1.1.2027')).status()).toBe(502)
    await expect(page.getByRole('button', { name: 'Retry reply', exact: true })).toBeVisible()
    if (edited) await page.getByLabel('Moving from', { exact: true }).fill('Panel origin')
    const revision = (await session(page)).revision
    await request.post('/__e2e/scenario', { data: { name: 'normal' } })
    const retried = page.waitForResponse((r) => r.url().endsWith('/api/conversation'))
    await page.getByRole('button', { name: 'Retry reply', exact: true }).click()
    const response = await retried
    await expect(pending(page)).toHaveCount(0)
    expect(response.request().postDataJSON().snapshot.revision).toBe(revision)
    expect(response.request().postDataJSON().messages.at(-1).content).toBe('from Tel Aviv to Raanana on 1.1.2027')
    if (edited) {
      await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('Panel origin')
      await expect(page.getByRole('button', { name: 'Accept suggestion', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Accept suggestion', exact: true }).click()
    }
    await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('Tel Aviv')
    expect((await session(page)).messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(writes(await state(request))).toEqual([])
    await send(page, 'origin address: 9 Oak Street, Haifa')
    await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('9 Oak Street, Haifa')
  })
}

test('stale in-flight reply rejected; refresh uses current revision without auto-applying old answer', async ({
  page,
  request,
}) => {
  await page.goto('/estimate')
  await gate(request, 'conversation')
  await input(page).fill('from Tel Aviv to Raanana on 1.1.2027')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await entered(request, 'conversation')
  await page.getByLabel('Moving from', { exact: true }).fill('Panel origin')
  await gate(request, 'conversation', true)
  await expect(pending(page)).toHaveCount(0)
  await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('Panel origin')
  await expect(page.getByRole('button', { name: 'Accept suggestion', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Retry reply', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Accept suggestion', exact: true })).toBeVisible()
  await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('Panel origin')
  await page.getByRole('button', { name: 'Accept suggestion', exact: true }).click()
  await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('Tel Aviv')
})

test('model review/item proposals require explicit acceptance and action hints never write', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  await upload(page, [2])
  await analyze(page)
  for (const command of [
    { type: 'item.add', item: { type: 'fixture lamp', count: 1 } },
    { type: 'followUp.answer', key: 'garage', answer: false },
    { type: 'coverage.answer', answer: true },
    { type: 'request.action', action: 'price' },
  ]) {
    await request.post('/__e2e/scenario', { data: { name: 'normal', commands: [command] } })
    const before = await session(page)
    await send(page, 'Synthetic explicit proposal request')
    const proposed = await session(page)
    expect(proposed.items).toEqual(before.items)
    expect(proposed.followUps).toEqual(before.followUps)
    expect(proposed.wholeMoveCovered).toEqual(before.wholeMoveCovered)
    await page.getByRole('button', { name: 'Accept suggestion', exact: true }).click()
    expect(writes(await state(request))).toEqual([])
  }
  await expect(log(page)).toContainText('Accepting a suggestion does not run it')
  expect((await session(page)).items.some((item) => item.type === 'fixture lamp')).toBe(true)
})

for (const viewport of [
  { name: 'user desktop', width: 917, height: 987 },
  { name: 'wide desktop', width: 1440, height: 1000 },
]) {
  test(`${viewport.name}: initial/latest visible, independent long columns and preserved readers`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/estimate')
    const feed = log(page)
    const panel = page.locator('.conv-shell > .conv-data-scroll')
    const anchor = feed.locator('[data-conversation-anchor="true"]')
    await expect(anchor).toBeInViewport({ ratio: 1 })
    await expect(input(page)).toBeInViewport({ ratio: 1 })
    await expect(page.getByLabel('Moving from', { exact: true })).toBeInViewport()
    await openPhotos(page)
    await upload(page, [2])
    await analyze(page)
    // Build long accepted inventory using the public UI, not fixture state injection.
    for (let index = 0; index < 16; index++) {
      await page.getByLabel('Add something we missed').fill(`synthetic item ${index}`)
      await page.getByRole('button', { name: 'Add', exact: true }).click()
    }
    for (let index = 0; index < 5; index++)
      await send(page, `History ${index}: ${'Synthetic history words. '.repeat(60)}`)
    await expect(anchor).toBeInViewport()
    await expect.poll(() => panel.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(200)
    const outerBefore = await page.evaluate(() => window.scrollY)
    const feedBefore = await feed.evaluate((node) => node.scrollTop)
    await panel.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    expect(await feed.evaluate((node) => node.scrollTop)).toBe(feedBefore)
    const panelBefore = await panel.evaluate((node) => node.scrollTop)
    await feed.evaluate((node) => {
      node.scrollTop = 0
      node.dispatchEvent(new Event('scroll'))
    })
    await input(page).fill('Unsent reader draft')
    await expect.poll(() => feed.evaluate((node) => node.scrollTop)).toBe(0)
    expect(await panel.evaluate((node) => node.scrollTop)).toBe(panelBefore)
    // Rerender a real card while an older-history reader remains at the top.
    await page.getByLabel('Add something we missed').fill('reader rerender item')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect.poll(() => feed.evaluate((node) => node.scrollTop)).toBe(0)
    // A reader at physical bottom of trailing cards is not the latest-message anchor reader.
    await feed.evaluate((node) => {
      node.scrollTop = node.scrollHeight
      node.dispatchEvent(new Event('scroll'))
    })
    const bottom = await feed.evaluate((node) => node.scrollTop)
    await input(page).fill('Physical bottom draft')
    await expect
      .poll(() => feed.evaluate((node, previous) => Math.abs(node.scrollTop - previous), bottom))
      .toBeLessThan(3)
    await send(page, 'Explicit Send resumes following')
    await expect(anchor).toBeInViewport()
    expect(await page.evaluate(() => window.scrollY)).toBe(outerBefore)
    expect(writes(await state(request))).toEqual([])
    await test.info().attach(`${viewport.name}-geometry.json`, {
      body: JSON.stringify(
        await page.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight },
          chat: document.querySelector('.conv-chat')?.getBoundingClientRect().toJSON(),
          data: document.querySelector('.conv-shell > .conv-data-scroll')?.getBoundingClientRect().toJSON(),
          log: document.querySelector('[role="log"]')?.getBoundingClientRect().toJSON(),
        })),
      ),
      contentType: 'application/json',
    })
  })
}

test('mobile right drawer traps focus, Escape restores trigger, latest hint and draft survive', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/estimate')
  const composer = await input(page).elementHandle()
  await send(page, 'from Tel Aviv to Raanana on 1.1.2027')
  const trigger = page.getByRole('button', { name: 'Open move manifest', exact: true })
  await expect(trigger).toContainText('Updated: details')
  await input(page).fill('Drawer-safe draft')
  await trigger.click()
  const drawer = page.getByRole('dialog', { name: 'Move manifest', exact: true })
  await expect(drawer).toBeVisible()
  const rect = await drawer.boundingBox()
  if (!rect) throw new Error('Drawer must have geometry')
  expect(rect.x + rect.width).toBeCloseTo(390, 0)
  expect(rect.x).toBeGreaterThanOrEqual(0)
  await expect(page.getByRole('button', { name: 'Close manifest', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Tab')
  expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true)
  await page.getByLabel('Moving from', { exact: true }).fill('Drawer edit origin')
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(input(page)).toHaveValue('Drawer-safe draft')
  expect(await composer?.evaluate((node) => node === document.querySelector('#conversation-message'))).toBe(true)
  await expect(log(page)).toContainText('from Tel Aviv to Raanana')
  expect(writes(await state(request))).toEqual([])
})

// CDP and VisualViewport emulation, not a physical keyboard/OS zoom guarantee.
test('short-height and simulated VisualViewport keyboard/pinch zoom keep composer reachable', async ({
  page,
  context,
  browser,
}) => {
  console.log(`Browser release: ${browser.version()}`)
  await page.setViewportSize({ width: 390, height: 500 })
  await page.goto('/estimate')
  await expect(log(page).locator('[data-conversation-anchor="true"]')).toBeInViewport()
  await expect(input(page)).toBeInViewport({ ratio: 1 })
  await expect(
    page
      .getByRole('button', { name: 'Choose from library', exact: true })
      .filter({ hasNot: page.locator('input') })
      .last(),
  ).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const panel = page.getByRole('region', { name: 'Chat about your move' })
  const initial = await panel.evaluate((node) => node.getBoundingClientRect().height)
  await page.evaluate(() => {
    const viewport = window.visualViewport
    if (!viewport) throw new Error('Chromium VisualViewport required')
    Object.defineProperty(viewport, 'height', { configurable: true, get: () => 350 })
    viewport.dispatchEvent(new Event('resize'))
  })
  await expect.poll(() => panel.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(initial - 100)
  expect(await input(page).evaluate((node) => node.getBoundingClientRect().bottom)).toBeLessThan(350)
  await input(page).fill('Emulated keyboard answer')
  await page.evaluate(() => {
    const viewport = window.visualViewport
    if (!viewport) throw new Error('Chromium VisualViewport required')
    Reflect.deleteProperty(viewport, 'height')
    viewport.dispatchEvent(new Event('resize'))
  })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 })
  await expect.poll(() => page.evaluate(() => visualViewport?.scale)).toBe(1.5)
  await input(page).scrollIntoViewIfNeeded()
  await expect(input(page)).toBeInViewport()
  await input(page).focus()
  await input(page).press('Tab')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(log(page)).toContainText('Emulated keyboard answer')
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 })
  await cdp.detach()
})

test('migrated fresh runtime is ready before endpoints; unseeded concurrent evidence is explicit', async ({
  page,
  request,
}) => {
  const health = await (await request.get('/__e2e/health')).json()
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
  await test.info().attach('fresh-runtime.json', {
    body: JSON.stringify({
      health,
      unseededConcurrentMoverStatuses: statuses,
      moversAfter: (await state(request)).movers,
      caveat:
        'Records inherited race evidence, NOT a concurrent-health acceptance assertion. UI tests use explicit synthetic seed.',
    }),
    contentType: 'application/json',
  })
  console.log(`Fresh migrated unseeded concurrent mover statuses: ${statuses.join(',')}`)
  // Exercise real read/write endpoints after migration, not readiness-only table names.
  await page.goto('/estimate')
  await send(page, 'from Tel Aviv to Raanana on 1.1.2027')
  await send(page, '15 miles')
  await page.getByRole('button', { name: 'Review move details', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm move details', exact: true }).click()
  await upload(page, [2])
  expect((await analyze(page)).status()).toBe(200)
  expect((await state(request)).receipts).toBe(1)
})
