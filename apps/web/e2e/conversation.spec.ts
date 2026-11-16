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
  expectPriceBlocked,
} from './fixtures.mjs'

const answer = (page) => page.getByRole('textbox', { name: 'Message', exact: true })
const feed = (page) => page.getByRole('log', { name: 'Move conversation' })
const cancelReply = (page) => page.getByRole('button', { name: 'Cancel reply', exact: true })
const pendingOperations = async (page) =>
  Object.values((await session(page)).operations).filter((operation) => operation.status === 'pending').length

async function acceptedInventory(page) {
  await openPhotos(page)
  await upload(page, [2])
  expect((await analyze(page)).status()).toBe(200)
  await review(page, { duplicates: [] })
}

async function saveExplicitly(page) {
  const saved = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/estimates' && response.request().method() === 'POST',
  )
  await priceButton(page).click()
  expect((await saved).status()).toBe(201)
  await expect(page.getByRole('button', { name: /View estimate/ })).toContainText('Saved reference')
}

async function history(page) {
  for (let index = 0; index < 5; index++)
    await send(page, `Reader history ${index}: ${'Synthetic local history. '.repeat(60)}`)
  await expect.poll(() => feed(page).evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(1000)
}

test('expired suggestion Refresh after failure and panel edits uses old answer/current revision and requires Accept', async ({
  page,
  request,
}) => {
  await page.goto('/estimate')
  const original = 'from Tel Aviv to Raanana on 1.1.2027'
  await request.post('/__e2e/scenario', { data: { name: 'normal', conversationFailure: true } })
  expect((await send(page, original)).status()).toBe(502)
  await page.getByLabel('Moving from', { exact: true }).fill('First panel origin')
  await request.post('/__e2e/scenario', { data: { name: 'normal' } })
  await page.getByRole('button', { name: 'Retry reply', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Accept suggestion', exact: true })).toBeVisible()
  await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('First panel origin')
  // Expire the pending proposal, then fail Refresh itself before another panel edit.
  await page.getByLabel('Moving from', { exact: true }).fill('Second panel origin')
  const refresh = page.getByRole('button', { name: 'Refresh suggestions', exact: true })
  await expect(refresh).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept suggestion', exact: true })).toHaveCount(0)
  await request.post('/__e2e/scenario', { data: { name: 'normal', conversationFailure: true } })
  const failed = page.waitForResponse((response) => response.url().endsWith('/api/conversation'))
  await refresh.click()
  expect((await failed).status()).toBe(502)
  await expect(cancelReply(page)).toHaveCount(0)
  await page.getByLabel('Moving from', { exact: true }).fill('Current panel origin')
  const current = await session(page)
  await request.post('/__e2e/scenario', { data: { name: 'normal' } })
  const refreshed = page.waitForResponse((response) => response.url().endsWith('/api/conversation'))
  await refresh.click()
  const response = await refreshed
  expect(response.status()).toBe(200)
  await expect(cancelReply(page)).toHaveCount(0)
  const sent = response.request().postDataJSON()
  expect(sent.snapshot.revision).toBe(current.revision)
  expect(sent.snapshot.moveDetails.from).toBe('Current panel origin')
  expect(sent.messages.filter((message) => message.role === 'user').at(-1).content).toBe(original)
  expect((await response.json()).proposals[0]).toMatchObject({ expectedRevision: current.revision })
  await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('Current panel origin')
  await expect(page.getByLabel('Moving to', { exact: true })).toHaveValue('')
  expect((await session(page)).revision).toBe(current.revision)
  await page.getByRole('button', { name: 'Accept suggestion', exact: true }).click()
  await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('Tel Aviv')
  await expect(page.getByLabel('Moving to', { exact: true })).toHaveValue('Raanana')
  expect((await session(page)).messages.filter((message) => message.role === 'user')).toHaveLength(1)
  expect(writes(await state(request))).toEqual([])
})

for (const mode of ['untouched', 'edited', 'cleared']) {
  test(`preferred date ${mode}: follows accepted move date only until customer edits it`, async ({ page, request }) => {
    await acceptedInventory(page)
    await saveExplicitly(page)
    const date = page.getByLabel('Preferred move date', { exact: true })
    await expect(date).toHaveValue('2027-01-01')
    if (mode === 'edited') await date.fill('2027-03-10')
    if (mode === 'cleared') await date.fill('')
    const before = writes(await state(request))
    const composer = await answer(page).elementHandle()
    await answer(page).fill('Date-card draft survives')
    // A real manifest edit invalidates dependent analysis/price/save, not the mounted card's local edit intent.
    await page.getByLabel('Move date', { exact: true }).fill('2027-02-02')
    await expect(date).toHaveCount(0)
    await expectPriceBlocked(page)
    expect((await session(page)).price).toBeNull()
    expect((await session(page)).estimateId).toBeNull()
    expect(writes(await state(request))).toEqual(before)
    await page.getByRole('button', { name: 'Review move details', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm move details', exact: true }).click()
    expect((await analyze(page)).status()).toBe(200)
    await review(page, { duplicates: [] })
    await saveExplicitly(page)
    await expect(date).toHaveValue(mode === 'untouched' ? '2027-02-02' : mode === 'edited' ? '2027-03-10' : '')
    await expect(answer(page)).toHaveValue('Date-card draft survives')
    expect(await composer?.evaluate((node) => node === document.querySelector('#conversation-message'))).toBe(true)
    const after = await state(request)
    expect(writes(after).filter((entry) => entry.method === 'PATCH')).toEqual([])
    expect(after.requests.filter((entry) => entry.path === '/api/price')).toHaveLength(2)
    expect(after.estimates).toBe(2)
  })
}

test('held price after a domain edit cannot restore price, inventory or dependent saved estimate', async ({
  page,
  request,
}) => {
  await acceptedInventory(page)
  await gate(request, 'after:POST /api/price')
  const priced = page.waitForResponse((response) => response.url().endsWith('/api/price'))
  await priceButton(page).click()
  await entered(request, 'after:POST /api/price')
  await answer(page).fill('Keep writing while price is pending')
  await page.getByLabel('Moving to', { exact: true }).fill('Updated destination while price pending')
  const edited = await session(page)
  expect(edited.analysis).toBeNull()
  expect(edited.items).toEqual([])
  expect(edited.price).toBeNull()
  expect(edited.estimateId).toBeNull()
  await gate(request, 'after:POST /api/price', true)
  expect((await priced).status()).toBe(200)
  await expect.poll(() => pendingOperations(page)).toBe(0)
  await expect(page.getByRole('alert')).toContainText('stale or not ready')
  const settled = await session(page)
  expect(settled.revision).toBe(edited.revision)
  expect(settled.analysis).toBeNull()
  expect(settled.items).toEqual([])
  expect(settled.price).toBeNull()
  expect(settled.estimateId).toBeNull()
  await expect(answer(page)).toHaveValue('Keep writing while price is pending')
  const data = await state(request)
  expect(data.estimates).toBe(0)
  expect(writes(data).map((entry) => entry.path)).toEqual(['/api/price'])
  await page.reload()
  await expect(page.getByLabel('Moving to', { exact: true })).toHaveValue('Updated destination while price pending')
  expect((await session(page)).price).toBeNull()
  expect(writes(await state(request))).toEqual(writes(data))
})

for (const viewport of [
  { name: 'desktop', width: 917, height: 987 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name}: long-history reader stays put on late reply and existing bubble growth; Send resumes follow`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/estimate')
    const log = feed(page)
    const latest = log.locator('[data-conversation-anchor="true"]')
    // Allow subpixel clipping (<1%) while requiring the readable latest message to remain visible.
    await expect(latest).toBeInViewport({ ratio: 0.99 })
    await history(page)
    await expect(latest).toBeInViewport({ ratio: 0.99 })
    const outer = await page.evaluate(() => window.scrollY)
    // Real ResizeObserver sees an existing preceding bubble grow while actively following latest.
    const followingTop = await log.evaluate((node) => node.scrollTop)
    await log
      .locator('[data-role="assistant"]')
      .first()
      .evaluate((node) => {
        node.append(document.createTextNode(' Existing message growth. '.repeat(50)))
      })
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBeGreaterThan(followingTop + 100)
    await expect(latest).toBeInViewport({ ratio: 0.99 })
    await gate(request, 'conversation')
    await answer(page).fill('Reply deliberately held while reader moves up')
    const arriving = page.waitForResponse((response) => response.url().endsWith('/api/conversation'))
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await entered(request, 'conversation')
    await expect(cancelReply(page)).toBeVisible()
    await log.evaluate((node) => {
      node.scrollTop = 0
      node.dispatchEvent(new Event('scroll'))
    })
    await answer(page).fill('Unsent long-history draft')
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBe(0)
    await gate(request, 'conversation', true)
    expect((await arriving).status()).toBe(200)
    await expect(cancelReply(page)).toHaveCount(0)
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBe(0)
    await expect(latest).not.toBeInViewport()
    await expect(answer(page)).toHaveValue('Unsent long-history draft')
    const count = await log.locator('[data-role="assistant"]').count()
    const height = await log.evaluate((node) => node.scrollHeight)
    // Same bubble, no new React message: exercises observer growth while reading older history.
    await log
      .locator('[data-role="assistant"]')
      .last()
      .evaluate((node) => {
        node.append(document.createTextNode(' Existing reply grows without a new message. '.repeat(80)))
      })
    await expect.poll(() => log.evaluate((node) => node.scrollHeight)).toBeGreaterThan(height + 100)
    expect(await log.locator('[data-role="assistant"]').count()).toBe(count)
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBe(0)
    await expect(answer(page)).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => window.scrollY)).toBe(outer)
    await send(page, 'Explicit Send resumes latest following')
    await expect(latest).toBeInViewport({ ratio: 0.99 })
    expect(await page.evaluate(() => window.scrollY)).toBe(outer)
    expect(writes(await state(request))).toEqual([])
  })

  test(`${viewport.name}: physical-bottom card-answer rerender preserves reader rather than jumping to latest reply`, async ({
    page,
    request,
  }) => {
    // Public desktop details entry, then same mounted conversation at the target viewport.
    await openPhotos(page)
    await upload(page, [2])
    expect((await analyze(page)).status()).toBe(200)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await history(page)
    const log = feed(page)
    const latest = log.locator('[data-conversation-anchor="true"]')
    const composer = await answer(page).elementHandle()
    await log.evaluate((node) => {
      node.scrollTop = node.scrollHeight
      node.dispatchEvent(new Event('scroll'))
    })
    const coverage = page
      .getByRole('group', { name: 'Does this cover the whole move?' })
      .getByRole('button', { name: 'Yes', exact: true })
    await expect(coverage).toBeInViewport({ ratio: 1 })
    // A contextual widget may fit beside the latest bubble; preserve the actual reader position either way.
    const before = await log.evaluate((node) => ({ top: node.scrollTop, height: node.scrollHeight }))
    await coverage.click()
    await expect(coverage).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => log.evaluate((node) => node.scrollHeight)).toBeGreaterThan(before.height)
    await expect.poll(() => log.evaluate((node, top) => Math.abs(node.scrollTop - top), before.top)).toBeLessThan(3)
    await answer(page).fill('Card-bottom draft')
    await expect.poll(() => log.evaluate((node, top) => Math.abs(node.scrollTop - top), before.top)).toBeLessThan(3)
    expect(await composer?.evaluate((node) => node === document.querySelector('#conversation-message'))).toBe(true)
    await send(page, 'Send resumes following after card answer')
    await expect(latest).toBeInViewport({ ratio: 0.99 })
    expect(writes(await state(request))).toEqual([])
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
}

for (const version of [3, 4]) {
  test(`v${version} legacy own-photo migration keeps reference but cannot invent a receipt or analysis`, async ({
    page,
    request,
  }) => {
    await acceptedInventory(page)
    const previous = await session(page)
    await page.evaluate((value) => {
      const draft = JSON.parse(sessionStorage.getItem('movers.estimate') ?? 'null')
      sessionStorage.setItem(
        'movers.estimate',
        JSON.stringify({ ...draft, version: value, step: 'estimate', photoRefs: [] }),
      )
    }, version)
    await page.reload()
    await expect(feed(page)).toContainText('Your earlier draft is here')
    await expect(page.getByRole('alert')).toContainText('Re-upload your photos')
    const migrated = await session(page)
    expect(migrated.version).toBe(6)
    expect(migrated.sessionId).toBe(previous.sessionId)
    expect(migrated.moveDetails).toEqual(previous.moveDetails)
    expect(migrated.photos).toHaveLength(1)
    expect(migrated.photos[0].url).toBe(previous.photos[0].url)
    expect(migrated.photos[0].receipt).toBeNull()
    expect(migrated.photoRefs).toEqual([])
    expect(migrated.analysis).toBeNull()
    expect(migrated.items).toEqual([])
    expect(migrated.detailsConfirmed).toBe(false)
    await page.getByRole('button', { name: 'Review move details', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm move details', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Analyse / })).toBeDisabled()
    await expectPriceBlocked(page)
    const before = await state(request)
    await page.reload()
    expect((await state(request)).calls).toEqual(before.calls)
    expect(writes(await state(request))).toEqual([])
  })
}

for (const mode of ['retry-once', 'malformed', 'provider-failure']) {
  test(`conversation ${mode}: real parser/provider boundary is bounded and preserves the user turn`, async ({
    page,
    request,
  }) => {
    await page.goto('/estimate')
    await request.post('/__e2e/scenario', {
      data: { name: 'normal', conversationMode: mode, conversationFailure: mode === 'provider-failure' },
    })
    const response = await send(page, 'from Tel Aviv to Raanana on 1.1.2027')
    expect(response.status()).toBe(mode === 'retry-once' ? 200 : 502)
    expect((await state(request)).conversationCalls).toBe(mode === 'provider-failure' ? 1 : 2)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('synthetic-private-envelope')
    await expect(feed(page)).not.toContainText('synthetic-private-envelope')
    expect((await session(page)).messages.filter((message) => message.role === 'user')).toHaveLength(1)
    if (mode === 'retry-once') await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('Tel Aviv')
    else {
      expect(body).toEqual({ error: 'Conversation unavailable. Please retry.', retryable: true })
      await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('')
      await expect(page.getByRole('button', { name: 'Accept suggestion', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Retry reply', exact: true })).toBeVisible()
    }
    expect(writes(await state(request))).toEqual([])
  })
}

test('conversation after date submission excludes actual stored contact, lead reference, receipts and photo URLs', async ({
  page,
  request,
}) => {
  await acceptedInventory(page)
  await saveExplicitly(page)
  const contact = { name: 'Synthetic Privacy Fixture', email: 'privacy-fixture@example.invalid', phone: '2025550198' }
  await page.getByLabel('Your name', { exact: true }).fill(contact.name)
  await page.getByLabel('Email', { exact: true }).fill(contact.email)
  await page.getByLabel('Phone', { exact: true }).fill(contact.phone)
  const dated = page.waitForResponse((response) => response.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Request this date', exact: true }).click()
  expect((await dated).status()).toBe(200)
  await expect(page.getByRole('region', { name: 'Date request' })).toContainText('not a confirmed booking')
  const stored = await session(page)
  expect(stored.contact).toMatchObject(contact)
  const response = await send(page, 'What remains to review?')
  expect(response.status()).toBe(200)
  const payload = response.request().postDataJSON()
  const text = JSON.stringify(payload)
  for (const value of Object.values(contact)) expect(text).not.toContain(value)
  expect(text).not.toContain(stored.estimateId)
  for (const photo of stored.photos) {
    expect(text).not.toContain(photo.url)
    expect(text).not.toContain(photo.receipt)
  }
  expect(payload.snapshot.status).toMatchObject({ estimateSaved: true, dateRequested: true })
  expect(Object.keys(payload.snapshot)).not.toContain('contact')
  const before = (await state(request)).conversationCalls
  // Real ingress rejects an added private snapshot field before invoking the provider.
  const invalid = await request.post('/api/conversation', {
    data: { ...payload, snapshot: { ...payload.snapshot, contact: { email: contact.email } } },
  })
  expect(invalid.status()).toBe(400)
  expect(await invalid.json()).toEqual({ error: 'Invalid conversation request', retryable: false })
  expect((await state(request)).conversationCalls).toBe(before)
})
