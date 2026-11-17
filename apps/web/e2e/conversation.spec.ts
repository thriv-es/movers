import {
  test,
  expect,
  send,
  session,
  state,
  writes,
  commercial,
  gate,
  entered,
  openPhotos,
  upload,
  ready,
  booking,
  propose,
  updateSession,
  composer,
  feed,
  manifestPanel,
  priceButton,
  endpoints,
} from './fixtures.mjs'

const pending = (page) => page.getByRole('button', { name: 'Cancel reply', exact: true })
async function history(page) {
  for (let index = 0; index < 5; index++)
    await send(page, `Reader history ${index}: ${'Synthetic local history. '.repeat(60)}`)
  await expect.poll(() => feed(page).evaluate((node) => node.scrollHeight - node.clientHeight)).toBeGreaterThan(1000)
}

test('keyboard summary/update restores composer focus, same thread and unsent draft without writes', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  const original = await session(page)
  const input = await composer(page).elementHandle()
  await composer(page).fill('Keep this draft and focus')
  await priceButton(page).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Your move estimate' })).toBeVisible()
  await page.getByRole('button', { name: 'Update this session' }).focus()
  await page.keyboard.press('Enter')
  await expect(composer(page)).toBeFocused()
  await expect(composer(page)).toHaveValue('Keep this draft and focus')
  expect(await input.evaluate((node) => node === document.querySelector('#conversation-message'))).toBe(true)
  expect((await session(page)).messages).toEqual(original.messages)
  expect(writes(await state(request))).toEqual([])
})

for (const mode of ['untouched', 'edited', 'cleared']) {
  test(`preferred date ${mode}: follows accepted date until customer intentionally edits it`, async ({
    page,
    request,
  }) => {
    await ready(page)
    await page.getByRole('button', { name: 'Book this move' }).click()
    const date = page.getByLabel('Preferred move date', { exact: true })
    await expect(date).toHaveValue('')
    if (mode === 'edited') await date.fill('2027-03-10')
    if (mode === 'cleared') {
      await date.fill('2027-03-10')
      await date.fill('')
    }
    await updateSession(page)
    await propose(page, { type: 'details.patch', patch: { date: '2027-02-02' } })
    const current = await session(page)
    expect(current.analysis).not.toBeNull() // Access/date corrections no longer discard accepted photo inventory.
    await composer(page).fill('Date draft survives')
    await priceButton(page).click()
    await expect(page.getByRole('button', { name: 'Book this move' })).toBeEnabled()
    await page.getByRole('button', { name: 'Book this move' }).click()
    await expect(date).toHaveValue(mode === 'untouched' ? '2027-02-02' : mode === 'edited' ? '2027-03-10' : '')
    await updateSession(page)
    await expect(composer(page)).toHaveValue('Date draft survives')
    const after = await state(request)
    expect(commercial(after)).toEqual([])
    expect(after.requests.filter((entry) => entry.path === '/api/price')).toHaveLength(2)
    expect(after.estimates).toBe(0)
  })
}

test('held price after a real photo edit cannot restore stale price or create a saved estimate', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  expect((await upload(page, [2])).status()).toBe(200)
  await gate(request, 'after:POST /api/price')
  await send(page, 'No garage extras, no closet extras, no appliance extras. This covers the whole move.')
  await entered(request, 'after:POST /api/price')
  await updateSession(page)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByText('Manage photo 1', { exact: true }).click()
  // Pending pricing intentionally disables destructive attachment controls; this is visible safety, not a bypass.
  await expect(page.getByRole('button', { name: 'Remove photo 1' })).toBeDisabled()
  await gate(request, 'after:POST /api/price', true)
  await expect.poll(async () => (await session(page)).price !== null).toBe(true)
  await page.getByRole('button', { name: 'Remove photo 1' }).click()
  expect((await session(page)).analysis).toBeNull()
  expect((await session(page)).items).toEqual([])
  expect((await session(page)).price).toBeNull()
  expect((await session(page)).estimateId).toBeNull()
  const data = await state(request)
  expect(data.estimates).toBe(0)
  expect(writes(data).map((entry) => entry.path)).toEqual(['/api/price'])
  await page.reload()
  expect((await session(page)).price).toBeNull()
  expect(writes(await state(request))).toEqual(writes(data))
})

for (const viewport of [
  { name: 'desktop', width: 917, height: 987 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`${viewport.name}: old-history reader stays put on late reply and bubble growth; explicit Send resumes follow`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/estimate')
    const log = feed(page)
    const latest = log.locator('[data-conversation-anchor="true"]')
    await expect(latest).toBeInViewport({ ratio: 0.99 })
    await history(page)
    await expect(latest).toBeInViewport({ ratio: 0.99 })
    const outer = await page.evaluate(() => window.scrollY)
    const followingTop = await log.evaluate((node) => node.scrollTop)
    await log
      .locator('[data-role="assistant"]')
      .first()
      .evaluate((node) => node.append(document.createTextNode(' Existing message growth. '.repeat(50))))
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBeGreaterThan(followingTop + 100)
    await expect(latest).toBeInViewport({ ratio: 0.99 })
    await gate(request, 'conversation')
    await composer(page).fill('Held reply while reader moves up')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await entered(request, 'conversation')
    await expect(pending(page)).toBeVisible()
    await log.evaluate((node) => {
      node.scrollTop = 0
      node.dispatchEvent(new Event('scroll'))
    })
    await composer(page).fill('Unsent long-history draft')
    await gate(request, 'conversation', true)
    await expect(pending(page)).toHaveCount(0)
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBe(0)
    await expect(latest).not.toBeInViewport()
    await expect(composer(page)).toHaveValue('Unsent long-history draft')
    const count = await log.locator('[data-role="assistant"]').count()
    const height = await log.evaluate((node) => node.scrollHeight)
    await log
      .locator('[data-role="assistant"]')
      .last()
      .evaluate((node) =>
        node.append(document.createTextNode(' Existing reply grows without a new message. '.repeat(80))),
      )
    await expect.poll(() => log.evaluate((node) => node.scrollHeight)).toBeGreaterThan(height + 100)
    expect(await log.locator('[data-role="assistant"]').count()).toBe(count)
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBe(0)
    await expect(composer(page)).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => window.scrollY)).toBe(outer)
    await send(page, 'Explicit Send resumes latest following')
    await expect(latest).toBeInViewport({ ratio: 0.99 })
    expect(await page.evaluate(() => window.scrollY)).toBe(outer)
    expect(writes(await state(request))).toEqual([])
  })
  test(`${viewport.name}: inline photo decision preserves reader/composer rather than reviving a card stack`, async ({
    page,
    request,
  }) => {
    await openPhotos(page)
    expect((await upload(page, [8])).status()).toBe(200)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await history(page)
    const input = await composer(page).elementHandle()
    const log = feed(page)
    await log.evaluate((node) => {
      node.scrollTop = node.scrollHeight
      node.dispatchEvent(new Event('scroll'))
    })
    const before = await log.evaluate((node) => node.scrollTop)
    await page.getByRole('button', { name: 'Keep photo 1' }).click()
    await expect(page.getByRole('button', { name: 'Keep photo 1' })).toHaveCount(0)
    // Removing the two decision buttons shrinks the physical scroll range; only unavoidable clamping is allowed.
    await expect
      .poll(() =>
        log.evaluate(
          (node, top) => Math.abs(node.scrollTop - Math.min(top, node.scrollHeight - node.clientHeight)),
          before,
        ),
      )
      .toBeLessThan(3)
    await composer(page).fill('Inline decision draft')
    expect(await input.evaluate((node) => node === document.querySelector('#conversation-message'))).toBe(true)
    await send(page, 'Resume following after photo review')
    await expect(log.locator('[data-conversation-anchor="true"]')).toBeInViewport({ ratio: 0.99 })
    expect(writes(await state(request))).toEqual([])
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
}

for (const version of [3, 4]) {
  test(`v${version} own-photo migration retains reference but cannot invent receipt or analysis`, async ({
    page,
    request,
  }) => {
    await openPhotos(page)
    await upload(page, [2])
    const previous = await session(page)
    await page.evaluate((value) => {
      const draft = JSON.parse(sessionStorage.getItem('movers.estimate'))
      sessionStorage.setItem(
        'movers.estimate',
        JSON.stringify({ ...draft, version: value, step: 'estimate', photoRefs: [] }),
      )
    }, version)
    await page.reload()
    await expect.poll(async () => (await session(page))?.version).toBe(6)
    expect((await session(page)).timeline).toContainEqual(
      expect.objectContaining({ kind: 'event', event: 'migration' }),
    )
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
    await expect(page.getByText('Photo 1 · Re-upload required')).toBeVisible()
    const before = await state(request)
    await page.reload()
    expect((await state(request)).calls).toEqual(before.calls)
    expect(writes(await state(request))).toEqual([])
  })
}

for (const mode of ['retry-once', 'malformed', 'provider-failure']) {
  test(`conversation ${mode}: real provider/parser boundary is bounded and preserves the turn`, async ({
    page,
    request,
  }) => {
    await page.goto('/estimate')
    await request.post('/__e2e/scenario', {
      data: { name: 'normal', conversationMode: mode, conversationFailure: mode === 'provider-failure' },
    })
    const response = await send(page, endpoints)
    expect(response.status()).toBe(mode === 'retry-once' ? 200 : 502)
    expect((await state(request)).conversationCalls).toBe(mode === 'provider-failure' ? 1 : 2)
    expect(JSON.stringify(await response.json())).not.toContain('synthetic-private-envelope')
    await expect(feed(page)).not.toContainText('synthetic-private-envelope')
    expect((await session(page)).messages.filter((message) => message.role === 'user')).toHaveLength(1)
    if (mode === 'retry-once') expect((await session(page)).moveDetails.from).toBe('12 Main Street, Boston, MA')
    else {
      expect((await session(page)).moveDetails.from).toBeNull()
      await expect(page.getByRole('button', { name: 'Accept suggestion' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Retry reply' })).toBeVisible()
    }
    expect(writes(await state(request))).toEqual([])
  })
}

test('post-callback conversation excludes actual stored contact, lead reference, receipts and URLs', async ({
  page,
  request,
}) => {
  await ready(page)
  await booking(page)
  await page.getByRole('button', { name: 'Request a callback' }).click()
  await expect(page.getByRole('heading', { name: 'Callback request recorded' })).toBeVisible()
  const stored = await session(page)
  expect(stored.contact.email).toBe('synthetic@example.invalid')
  await updateSession(page)
  const response = await send(page, 'What remains to review?')
  expect(response.status()).toBe(200)
  const payload = response.request().postDataJSON()
  const text = JSON.stringify(payload)
  for (const value of [
    stored.contact.name,
    stored.contact.email,
    stored.contact.phone,
    stored.estimateId,
    ...stored.photos.flatMap((photo) => [photo.url, photo.receipt]),
  ])
    expect(text).not.toContain(value)
  expect(payload.snapshot.status).toMatchObject({ estimateSaved: true, dateRequested: true })
  expect(Object.keys(payload.snapshot)).not.toContain('contact')
  const before = (await state(request)).conversationCalls
  const invalid = await request.post('/api/conversation', {
    data: { ...payload, snapshot: { ...payload.snapshot, contact: { email: stored.contact.email } } },
  })
  expect(invalid.status()).toBe(400)
  expect(await invalid.json()).toEqual({ error: 'Invalid conversation request', retryable: false })
  expect((await state(request)).conversationCalls).toBe(before)
  await updateSession(page)
  await expect(manifestPanel(page)).toContainText('desk')
})
