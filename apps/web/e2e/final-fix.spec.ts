import {
  test,
  expect,
  send,
  session,
  state,
  writes,
  openPhotos,
  upload,
  review,
  propose,
  expectPriceBlocked,
  updateSession,
  composer,
  manifestPanel,
} from './fixtures.mjs'
const chatRequests = (data) => data.requests.filter((entry) => entry.path === '/api/conversation')

test('bounded history survives oversized legacy input, rejected new draft, retry and reload without losing latest question', async ({
  page,
  request,
}) => {
  await page.goto('/estimate')
  await expect(composer(page)).toBeVisible()
  await expect.poll(async () => (await session(page))?.version).toBe(6)
  const original = await session(page)
  const messages = Array.from({ length: 220 }, (_, index) => ({
    id: `old-${index}`,
    role: 'user',
    content: `History ${index}`,
  }))
  messages.push(
    { id: 'oversized', role: 'user', content: 'x'.repeat(12001) },
    { id: 'question', role: 'assistant', content: 'What is the origin city or address?' },
  )
  await page.evaluate(
    ({ original, messages }) =>
      sessionStorage.setItem(
        'movers.estimate',
        JSON.stringify({
          ...original,
          messages,
          timeline: messages.map((message) => ({ kind: 'message', id: message.id, revision: 0, message })),
        }),
      ),
    { original, messages },
  )
  await page.reload()
  await expect(page.getByRole('log')).toContainText('History 0')
  await expect.poll(async () => (await session(page)).sessionId).toBe(original.sessionId)
  await request.post('/__e2e/scenario', { data: { name: 'normal', conversationMode: 'mock' } })
  const before = await session(page)
  await composer(page).fill('x'.repeat(12001))
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('12,000')
  await expect(composer(page)).toHaveValue('x'.repeat(12001))
  expect(await session(page)).toEqual(before)
  expect(chatRequests(await state(request))).toEqual([])
  const response = await send(page, 'Tel Aviv')
  expect(response.status()).toBe(200)
  const body = response.request().postDataJSON()
  expect(body.messages).toEqual([messages.at(-1), expect.objectContaining({ role: 'user', content: 'Tel Aviv' })])
  expect(body.snapshot.moveDetails.from).toBeNull()
  expect((await session(page)).moveDetails.from).toBe('Tel Aviv')
  expect((await session(page)).messages.slice(0, 222)).toEqual(messages)
  expect((await session(page)).timeline.slice(0, 222).map((entry) => entry.message)).toEqual(messages)
  await request.post('/__e2e/scenario', { data: { name: 'normal', conversationFailure: true } })
  expect((await send(page, 'From 12 Main Street, Boston, MA to 9 Oak Street, Hartford, CT.')).status()).toBe(502)
  await request.post('/__e2e/scenario', { data: { name: 'normal' } })
  const retried = page.waitForResponse((reply) => reply.url().endsWith('/api/conversation'))
  await page.getByRole('button', { name: 'Retry reply' }).click()
  expect((await retried).status()).toBe(200)
  await expect.poll(async () => (await session(page)).moveDetails.to).toBe('9 Oak Street, Hartford, CT')
  const settled = await session(page)
  expect(
    settled.messages.filter(
      (entry) => entry.content === 'From 12 Main Street, Boston, MA to 9 Oak Street, Hartford, CT.',
    ),
  ).toHaveLength(1)
  await page.reload()
  expect((await session(page)).messages).toEqual(settled.messages)
  expect((await send(page, 'hello')).status()).toBe(200)
  expect((await session(page)).messages.slice(0, 222)).toEqual(messages)
  expect(writes(await state(request))).toEqual([])
})

for (const resolution of ['same', 'different']) {
  test(`v5 long-label inventory count/remove and duplicate ${resolution} use explicit chat review`, async ({
    page,
    request,
  }) => {
    await openPhotos(page)
    expect((await upload(page, [2])).status()).toBe(200)
    const original = await session(page)
    const label = `legacy custom ${'x'.repeat(220)}`
    await page.evaluate(
      ({ original, label }) => {
        const items = [
          { type: label, count: 2 },
          { type: 'desk', count: 1 },
        ]
        sessionStorage.setItem(
          'movers.estimate',
          JSON.stringify({
            ...original,
            version: 5,
            step: 'review',
            items,
            analysis: { ...original.analysis, items, possibleDuplicates: [{ item: label, count: 2 }] },
          }),
        )
      },
      { original, label },
    )
    await page.reload()
    await expect.poll(async () => (await session(page))?.version).toBe(6)
    expect((await session(page)).timeline).toContainEqual(
      expect.objectContaining({ kind: 'event', event: 'migration' }),
    )
    await propose(page, { type: 'item.count', itemType: label, count: 3 })
    expect((await session(page)).items[0]).toEqual({ type: label, count: 3 })
    await propose(page, { type: 'item.count', itemType: label, count: 2 })
    expect((await session(page)).items[0]).toEqual({ type: label, count: 2 })
    await expectPriceBlocked(page)
    await review(page, { duplicates: [{ item: label, count: 2, resolution }] })
    await expect(page.getByRole('button', { name: 'Book this move' })).toBeEnabled()
    expect((await session(page)).items).toEqual([
      { type: label, count: resolution === 'same' ? 1 : 2 },
      { type: 'desk', count: 1 },
    ])
    await page.reload()
    expect((await session(page)).photoRefs).toEqual(original.photoRefs)
    expect((await session(page)).moveDetails).toEqual(original.moveDetails)
    expect((await session(page)).duplicateResolutions).toEqual({ [label]: resolution })
    await propose(page, { type: 'item.remove', itemType: label })
    expect((await session(page)).items).toEqual([{ type: 'desk', count: 1 }])
    expect((await state(request)).estimates).toBe(0)
    // Read-only price replaced the old save-on-review behavior; no commercial request is implied.
    expect(writes(await state(request)).every((entry) => entry.path === '/api/price')).toBe(true)
  })
}

test('actual offline extractor handles side-labelled street fragments and explicit city replacement without inventing a side', async ({
  page,
  request,
}) => {
  await page.goto('/estimate')
  await request.post('/__e2e/scenario', { data: { name: 'normal', conversationMode: 'mock' } })
  expect((await send(page, 'from Tel Aviv to Raanana on 1.1.2027')).headers()['x-movers-ai-mode']).toBe('mock')
  for (const [text, field, expected] of [
    ['origin street: 12 Main Street', 'from', '12 Main Street, Tel Aviv'],
    ['destination street: 9 Oak Street', 'to', '9 Oak Street, Raanana'],
    ['origin street: 12 Main Street, Haifa', 'from', '12 Main Street, Haifa'],
  ]) {
    const response = await send(page, text)
    expect(response.status()).toBe(200)
    expect(response.headers()['x-movers-ai-mode']).toBe('mock')
    expect((await response.json()).reply).not.toMatch(/origin or destination/i)
    expect((await session(page)).moveDetails[field]).toBe(expected)
    await expect(manifestPanel(page)).toContainText(expected)
  }
  const before = (await session(page)).moveDetails
  const ambiguous = await send(page, '12 Unknown Street')
  expect((await ambiguous.json()).proposals).toEqual([])
  expect((await session(page)).moveDetails).toEqual(before)
  const distance = await send(page, '15')
  expect((await distance.json()).proposals).toEqual([])
  expect((await session(page)).moveDetails.distanceMiles).toBeNull()
  expect((await state(request)).conversationCalls).toBe(0)
  expect(writes(await state(request))).toEqual([])
  await updateSession(page)
})
