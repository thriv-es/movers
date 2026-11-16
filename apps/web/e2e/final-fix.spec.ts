import {
  test,
  expect,
  send,
  session,
  state,
  writes,
  openPhotos,
  upload,
  analyze,
  review,
  priceButton,
} from './fixtures.mjs'

const composer = (page) => page.getByRole('textbox', { name: 'Message', exact: true })
const chatRequests = (data) => data.requests.filter((entry) => entry.path === '/api/conversation')

test('bounded history survives legacy oversize, rejected new input, retry and reload without losing the latest question', async ({
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
    ({ original, messages }) => {
      sessionStorage.setItem(
        'movers.estimate',
        JSON.stringify({
          ...original,
          messages,
          timeline: messages.map((message) => ({ kind: 'message', id: message.id, revision: 0, message })),
        }),
      )
    },
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
  await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('Tel Aviv')
  expect((await session(page)).messages.slice(0, 222)).toEqual(messages)
  expect((await session(page)).timeline.slice(0, 222).map((entry) => entry.message)).toEqual(messages)
  await request.post('/__e2e/scenario', { data: { name: 'normal', conversationFailure: true } })
  expect((await send(page, 'from Tel Aviv to Raanana on 1.1.2027')).status()).toBe(502)
  await request.post('/__e2e/scenario', { data: { name: 'normal' } })
  const retried = page.waitForResponse((reply) => reply.url().endsWith('/api/conversation'))
  await page.getByRole('button', { name: 'Retry reply', exact: true }).click()
  expect((await retried).status()).toBe(200)
  await expect(page.getByLabel('Moving to', { exact: true })).toHaveValue('Raanana')
  const settled = await session(page)
  expect(settled.messages.filter((entry) => entry.content === 'from Tel Aviv to Raanana on 1.1.2027')).toHaveLength(1)
  await page.reload()
  expect((await session(page)).messages).toEqual(settled.messages)
  expect((await send(page, 'hello')).status()).toBe(200)
  expect((await session(page)).messages.slice(0, 222)).toEqual(messages)
  expect(writes(await state(request))).toEqual([])
})

for (const resolution of ['same', 'different']) {
  test(`v5 long-label inventory count/remove and duplicate ${resolution} controls recover pricing readiness`, async ({
    page,
    request,
  }) => {
    await openPhotos(page)
    await upload(page, [2])
    expect((await analyze(page)).status()).toBe(200)
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
    await expect(page.getByRole('log')).toContainText('Your earlier draft is here')
    await page.getByRole('button', { name: 'Confirm move details', exact: true }).click()
    const row = page.getByRole('listitem', { name: `${label} count`, exact: true })
    await row.getByRole('button', { name: `One more ${label}`, exact: true }).click()
    expect((await session(page)).items[0]).toEqual({ type: label, count: 3 })
    await row.getByRole('button', { name: `One fewer ${label}`, exact: true }).click()
    expect((await session(page)).items[0]).toEqual({ type: label, count: 2 })
    await expect(priceButton(page)).toBeDisabled()
    await review(page, { duplicates: [{ item: label, count: 2, resolution }] })
    await expect(priceButton(page)).toBeEnabled()
    const expectedCount = resolution === 'same' ? 1 : 2
    expect((await session(page)).items).toEqual([
      { type: label, count: expectedCount },
      { type: 'desk', count: 1 },
    ])
    await page.reload()
    expect((await session(page)).photoRefs).toEqual(original.photoRefs)
    expect((await session(page)).moveDetails).toEqual(original.moveDetails)
    expect((await session(page)).duplicateResolutions).toEqual({ [label]: resolution })
    await expect(page.getByRole('button', { name: /^(Same|Different) / })).toHaveCount(0)
    await row.getByRole('button', { name: 'Remove', exact: true }).click()
    expect((await session(page)).items).toEqual([{ type: 'desk', count: 1 }])
    await expect(priceButton(page)).toBeEnabled()
    expect(writes(await state(request))).toEqual([])
  })
}

test('actual mock handles side-labelled street fragments and explicit city replacement without inventing a side', async ({
  page,
  request,
}) => {
  await page.goto('/estimate')
  await request.post('/__e2e/scenario', { data: { name: 'normal', conversationMode: 'mock' } })
  expect((await send(page, 'from Tel Aviv to Raanana on 1.1.2027')).headers()['x-movers-ai-mode']).toBe('mock')
  for (const [text, field, expected] of [
    ['origin street: 12 Main Street', 'Moving from', '12 Main Street, Tel Aviv'],
    ['destination street: 9 Oak Street', 'Moving to', '9 Oak Street, Raanana'],
    ['origin street: 12 Main Street, Haifa', 'Moving from', '12 Main Street, Haifa'],
  ]) {
    const response = await send(page, text)
    expect(response.status()).toBe(200)
    expect(response.headers()['x-movers-ai-mode']).toBe('mock')
    expect((await response.json()).reply).not.toMatch(/origin or destination/i)
    await expect(page.getByLabel(field, { exact: true })).toHaveValue(expected)
  }
  const before = (await session(page)).moveDetails
  const ambiguous = await send(page, '12 Unknown Street')
  expect((await ambiguous.json()).proposals).toEqual([])
  expect((await session(page)).moveDetails).toEqual(before)
  const distance = await send(page, '15')
  expect((await distance.json()).proposals).toEqual([])
  // The ambiguous-address clarification is not a distance question; no stale question can authorize this answer.
  expect((await session(page)).moveDetails.distanceMiles).toBeNull()
  expect((await state(request)).conversationCalls).toBe(0)
  expect(writes(await state(request))).toEqual([])
})
