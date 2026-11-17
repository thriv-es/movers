import {
  test,
  expect,
  openPhotos,
  upload,
  photos,
  session,
  expectPriceBlocked,
  manifestPanel,
  review,
  state,
  writes,
  commercial,
  send,
  gate,
  entered,
  ready,
  booking,
  updateSession,
  composer,
  priceButton,
  propose,
} from './fixtures.mjs'

// Real routes/D1/R2; synthetic provider verdicts, never JPEG semantic ground truth.
test('ten immutable photos: receipts, relevance decisions, reviewed price and explicit callback in one mounted chat', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  const input = await composer(page).elementHandle()
  const log = await page.getByRole('log').elementHandle()
  const mounted = async () => {
    expect(await input.evaluate((node) => node === document.querySelector('#conversation-message'))).toBe(true)
    expect(await log.evaluate((node) => node === document.querySelector('[role="log"]'))).toBe(true)
  }
  const response = await upload(page, [9, 0, 7, 2, 8, 5, 1, 6, 4, 3])
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result.photoLinkStatuses.map((photo) => photo.status)).toEqual(Array(10).fill('eligible'))
  expect(result.photoAssessments.map((photo) => photo.status).sort()).toEqual([
    ...Array(6).fill('relevant'),
    'uncertain',
    'uncertain',
    'unrelated',
    'unrelated',
  ])
  expect(result.items.map((item) => item.type).sort()).toEqual([
    'bed',
    'desk',
    'dining table',
    'microwave',
    'sofa',
    'tool chest',
  ])
  expect(result.totalVolumeCubicFeet).toBe(120)
  await expectPriceBlocked(page)
  const uploaded = await session(page)
  const kept = uploaded.photos.find((photo) => new URL(photo.url).pathname.endsWith(photos[9].file))
  const excluded = uploaded.photos.find((photo) => new URL(photo.url).pathname.endsWith(photos[8].file))
  expect(kept.id).not.toBe(excluded.id)
  const photoCard = (photo) =>
    page
      .getByRole('list', { name: 'Selected photos' })
      .getByRole('listitem')
      .filter({ has: page.locator(`img[src="${photo.url}"]`) })
  await photoCard(kept)
    .getByRole('button', { name: /^Keep photo / })
    .click()
  await expectPriceBlocked(page)
  await photoCard(excluded)
    .getByRole('button', { name: /^Exclude photo / })
    .click()
  expect((await session(page)).photoDecisions).toEqual({ [kept.url]: 'keep', [excluded.url]: 'exclude' })
  await mounted()
  const pricedResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/price')
  await review(page, { duplicates: [{ item: 'sofa', count: 2, resolution: 'same' }] })
  const priced = await pricedResponse
  expect(priced.status()).toBe(200)
  await expect(page.getByRole('button', { name: 'Book this move' })).toBeEnabled()
  expect(commercial(await state(request))).toEqual([])
  const expectedItems = [
    { type: 'bed', count: 1 },
    { type: 'bookshelf', count: 1 },
    { type: 'desk', count: 1 },
    { type: 'dining table', count: 1 },
    { type: 'microwave', count: 1 },
    { type: 'sofa', count: 1 },
    { type: 'tool chest', count: 1 },
  ]
  const sent = priced.request().postDataJSON()
  expect([...sent.analysis.items].sort((a, b) => a.type.localeCompare(b.type))).toEqual(expectedItems)
  for (const excludedType of ['armchair', 'unrelated beach umbrella', 'unrelated food platter'])
    expect(sent.analysis.items.some((item) => item.type === excludedType)).toBe(false)
  expect(sent.analysis.totalVolumeCubicFeet).toBe(140)
  expect(sent.analysis.possibleDuplicates).toEqual([{ item: 'sofa', count: 2 }])
  expect(sent.review).toEqual({
    followUps: { garage: false, closets: false, appliances: false },
    wholeMoveCovered: true,
    photoEvidence: { excludedCount: 3, unresolvedCount: 0 },
  })
  const durable = await session(page)
  expect([...durable.items].sort((a, b) => a.type.localeCompare(b.type))).toEqual(expectedItems)
  expect(durable.analysis.totalVolumeCubicFeet).toBe(120) // Original evidence is immutable; reviewed total is separately projected.
  await booking(page)
  await page.getByRole('button', { name: 'Request a callback' }).click()
  await expect(page.getByRole('heading', { name: 'Callback request recorded' })).toBeVisible()
  await mounted()
  const before = await state(request)
  expect(before.uploads.map((entry) => entry.file).sort()).toEqual(photos.map((photo) => photo.file).sort())
  expect(before.uploads.every((entry) => entry.bytes > 1000 && /^[a-f0-9]{64}$/.test(entry.hash))).toBe(true)
  expect(new Set(before.uploads.map((entry) => entry.hash)).size).toBe(10)
  expect(before.calls.map((entry) => entry.hash).sort()).toEqual(before.uploads.map((entry) => entry.hash).sort())
  expect({
    receipts: before.receipts,
    objects: before.objects,
    estimates: before.estimates,
    quotes: before.quotes,
    logs: before.emailLogsSuppressed,
  }).toEqual({ receipts: 10, objects: 10, estimates: 1, quotes: 0, logs: 0 })
  expect(
    before.requests
      .filter((entry) => entry.path.startsWith('/api/images/') && entry.method === 'GET')
      .every((entry) => entry.status === 200),
  ).toBe(true)
  expect(writes(before).map((entry) => `${entry.method} ${entry.path}`)).toEqual(
    ['/api/price', '/api/estimates', `/api/estimates/${(await session(page)).estimateId}/contact`].map(
      (path, index) => `${index === 2 ? 'PATCH' : 'POST'} ${path}`,
    ),
  )
  await page.reload()
  expect((await session(page)).photoDecisions).toEqual(durable.photoDecisions)
  expect((await session(page)).duplicateResolutions).toEqual({ sofa: 'same' })
  expect([...(await session(page)).items].sort((a, b) => a.type.localeCompare(b.type))).toEqual(expectedItems)
  expect(writes(await state(request))).toEqual(writes(before))
})

test('retained quote API records only the explicitly selected mover, while the new customer UI never offers quotes', async ({
  page,
  request,
}) => {
  await ready(page)
  await booking(page)
  await page.getByRole('button', { name: 'Request a callback' }).click()
  await expect(page.getByRole('heading', { name: 'Callback request recorded' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Choose movers' })).toHaveCount(0)
  expect((await state(request)).quotes).toBe(0)
  const estimateId = (await session(page)).estimateId
  const movers = await request.get('/api/movers')
  expect(movers.status()).toBe(200)
  expect((await movers.json()).movers.map((mover) => mover.id).sort()).toEqual(['e2e-mover-a', 'e2e-mover-b'])
  // Compatibility integration, not reconstructed customer UI: exercise the actual retained API/D1/log boundary.
  const response = await request.post('/api/quote-requests', {
    data: { estimateId, moverIds: ['e2e-mover-a'], note: 'Synthetic selected-mover note' },
  })
  expect(response.status()).toBe(201)
  const body = await response.json()
  expect(body.requests).toHaveLength(1)
  expect(body.requests[0]).toMatchObject({
    estimateId,
    moverId: 'e2e-mover-a',
    moverName: 'Synthetic Fixture Movers a',
    status: 'logged',
  })
  expect(body.delivery).toEqual({ 'e2e-mover-a': 'logged' })
  const data = await state(request)
  expect(data.estimates).toBe(1)
  expect(data.quotes).toBe(1)
  expect(data.emailLogsSuppressed).toBe(1)
  expect(data.requests.filter((entry) => entry.path === '/api/quote-requests')).toEqual([
    { path: '/api/quote-requests', method: 'POST', status: 201 },
  ])
  expect(data.receipts).toBe(1)
  expect(data.objects).toBe(1)
})

test('uncertain-only candidates require Keep before accepted inventory and complete review', async ({ page }) => {
  await openPhotos(page)
  const response = await upload(page, [8])
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result.items).toEqual([])
  expect(result.totalVolumeCubicFeet).toBe(0)
  expect(result.estimatedBoxes).toEqual({ min: 0, max: 0 })
  await expectPriceBlocked(page)
  expect((await session(page)).items).toEqual([])
  await page.getByRole('button', { name: 'Keep photo 1' }).click()
  await expect(manifestPanel(page)).toContainText('armchair')
  await review(page, { duplicates: [] })
  await expect(page.getByRole('button', { name: 'Book this move' })).toBeEnabled()
})

test('exclude-all blocks empty pricing across reload; explicit added item cannot fabricate relevant-photo evidence', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  expect((await upload(page, [8, 9])).status()).toBe(200)
  await page.getByRole('button', { name: 'Exclude photo 1' }).click()
  await page.getByRole('button', { name: 'Exclude photo 2' }).click()
  await review(page, { duplicates: [] })
  await expectPriceBlocked(page)
  await page.reload()
  expect((await session(page)).items).toEqual([])
  await expectPriceBlocked(page)
  expect(writes(await state(request))).toEqual([])
  await propose(page, { type: 'item.add', item: { type: 'fixture trunk', count: 1 } })
  expect((await session(page)).items).toEqual([{ type: 'fixture trunk', count: 1 }])
  await expectPriceBlocked(page)
  expect(writes(await state(request))).toEqual([])
})

test('a different session cannot analyze a valid uploaded receipt', async ({ page, request }) => {
  await openPhotos(page)
  expect((await upload(page, [0])).status()).toBe(200)
  const draft = await session(page)
  const before = (await state(request)).calls.length
  const response = await request.post('/api/analyze', {
    data: { sessionId: crypto.randomUUID(), photoRefs: draft.photoRefs, moveDetails: draft.moveDetails },
  })
  expect(response.status()).toBe(400)
  const body = await response.json()
  expect(body.code).toBe('NO_USABLE_PHOTOS')
  expect(body.photoAssessments[0].status).toBe('unlinked')
  expect((await state(request)).calls).toHaveLength(before)
})

test('stale vision fingerprint rejects real pricing without saving or validating old evidence', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  expect((await upload(page, [0])).status()).toBe(200)
  await review(page, { duplicates: [{ item: 'sofa', count: 2, resolution: 'same' }] })
  await updateSession(page)
  const draft = await session(page)
  expect((await request.post('/__e2e/change-vision')).ok()).toBe(true)
  const response = await request.post('/api/price', {
    data: { analysis: draft.analysis, moveDetails: draft.moveDetails },
  })
  expect(response.status()).toBe(409)
  expect((await response.json()).code).toBe('REANALYZE_REQUIRED')
  await page.reload()
  await priceButton(page).click()
  await expect(page.getByRole('dialog', { name: 'Your move estimate' }).getByRole('alert')).toContainText(
    'Analyze your photos again',
  )
  expect((await state(request)).estimates).toBe(0)
})

for (const scenario of ['retry-once', 'malformed', 'provider-failure']) {
  test(`${scenario}: real photo-assessment retry and failure boundaries remain bounded`, async ({ page, request }) => {
    await request.post('/__e2e/scenario', { data: { name: scenario } })
    await openPhotos(page)
    const response = await upload(page, [2])
    expect(response.status()).toBe(scenario === 'retry-once' ? 200 : scenario === 'malformed' ? 400 : 503)
    const data = await state(request)
    expect(data.calls).toHaveLength(scenario === 'provider-failure' ? 1 : 2)
    if (scenario === 'retry-once') await expect(manifestPanel(page)).toContainText('desk')
    else {
      await expect(page.getByRole('region', { name: 'Conversation photos' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Retry analyze' })).toBeVisible()
      expect((await session(page)).analysis).toBeNull()
      expect(writes(data)).toEqual([])
      if (scenario === 'malformed') expect((await response.json()).code).toBe('ANALYSIS_FAILED')
    }
  })
}

test('unrelated-only photos remain rejected without usable inventory', async ({ page }) => {
  await openPhotos(page)
  const response = await upload(page, [6, 7])
  expect(response.status()).toBe(400)
  expect((await response.json()).code).toBe('NO_USABLE_PHOTOS')
  await expectPriceBlocked(page)
})

test('test reset removes actual local receipts, objects and synthetic leads', async ({ page, request }) => {
  await openPhotos(page)
  await upload(page, [0])
  expect((await request.post('/__e2e/reset')).ok()).toBe(true)
  const data = await state(request)
  expect({
    receipts: data.receipts,
    objects: data.objects,
    estimates: data.estimates,
    uploads: data.uploads,
    calls: data.calls,
  }).toEqual({ receipts: 0, objects: 0, estimates: 0, uploads: [], calls: [] })
})

test('v5 receipt-backed draft migration does not invent confirmation or writes', async ({ page, request }) => {
  await openPhotos(page)
  await upload(page, [2])
  const draft = await session(page)
  await page.evaluate(
    (value) => sessionStorage.setItem('movers.estimate', JSON.stringify({ ...value, version: 5, step: 'estimate' })),
    draft,
  )
  await page.reload()
  await expect.poll(async () => (await session(page))?.version).toBe(6)
  expect((await session(page)).timeline).toContainEqual(expect.objectContaining({ kind: 'event', event: 'migration' }))
  const migrated = await session(page)
  expect(migrated.version).toBe(6)
  expect(migrated.detailsConfirmed).toBe(false)
  expect(migrated.moveDetails).toEqual(draft.moveDetails)
  expect(migrated.photoRefs).toEqual(draft.photoRefs)
  expect(migrated.items).toEqual(draft.items)
  expect(migrated.sessionId).toBe(draft.sessionId)
  expect(writes(await state(request))).toEqual([])
})

for (const reverse of [false, true]) {
  test(`overlapping selections retain both receipts: ${reverse ? 'second' : 'first'} completes first`, async ({
    page,
    request,
  }) => {
    await openPhotos(page)
    const keys = [0, 1].map((index) => `upload:${photos[index].file}`)
    for (const key of keys) await gate(request, key)
    await page.getByLabel('Choose from library', { exact: true }).setInputFiles(photos[0].path)
    await entered(request, keys[0])
    await page.getByLabel('Choose from library', { exact: true }).setInputFiles(photos[1].path)
    await entered(request, keys[1])
    await gate(request, keys[reverse ? 1 : 0], true)
    await expect.poll(async () => (await session(page)).photos.length).toBe(1)
    await gate(request, keys[reverse ? 0 : 1], true)
    await expect.poll(async () => (await session(page)).photos.length).toBe(2)
    await expect.poll(async () => (await session(page)).analysis !== null).toBe(true)
    expect((await session(page)).photos.every((photo) => photo.receipt)).toBe(true)
    expect((await state(request)).calls).toHaveLength(2)
  })
}

test('real photo edit rejects an old pending upload cohort', async ({ page, request }) => {
  await openPhotos(page)
  await upload(page, [8])
  const key = `upload:${photos[0].file}`
  await gate(request, key)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByLabel('Choose from library', { exact: true }).setInputFiles(photos[0].path)
  await entered(request, key)
  await page.getByRole('button', { name: 'Keep photo 1' }).click()
  await gate(request, key, true)
  await expect(page.getByText('Upload failed — not attached')).toBeVisible()
  expect((await session(page)).photos).toHaveLength(1)
  expect((await session(page)).photoRefs).toHaveLength(1)
})

for (const boundary of ['preflight', 'price']) {
  test(`attachment selected during held ${boundary} blocks dependent saved-estimate work`, async ({
    page,
    request,
  }) => {
    await ready(page)
    await updateSession(page)
    const key = boundary === 'preflight' ? 'after:GET /api/ai-status' : 'after:POST /api/price'
    // A source-bound Send corrects the date and automatically opens its new read-only price summary.
    await request.post('/__e2e/scenario', {
      data: { name: 'normal', commands: [{ type: 'details.patch', patch: { date: '2027-02-02' } }] },
    })
    await gate(request, key)
    await composer(page).fill('Move date: 2027-02-02')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await entered(request, key)
    await updateSession(page)
    const uploadKey = `upload:${photos[1].file}`
    await gate(request, uploadKey)
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByLabel('Choose from library', { exact: true }).setInputFiles(photos[1].path)
    await entered(request, uploadKey)
    await gate(request, key, true)
    await expect
      .poll(async () => Object.values((await session(page)).operations).filter((op) => op.status === 'pending').length)
      .toBe(0)
    const data = await state(request)
    expect(data.estimates).toBe(0)
    expect(commercial(data)).toEqual([])
    expect(data.requests.filter((entry) => entry.path === '/api/price')).toHaveLength(boundary === 'price' ? 2 : 1)
    expect((await session(page)).photos).toHaveLength(1)
  })
}

test('callback save failure retries save without repricing or duplicate date submission', async ({ page, request }) => {
  await ready(page)
  await booking(page)
  await request.post('/__e2e/scenario', { data: { name: 'normal', saveFailures: 1 } })
  await page.getByRole('button', { name: 'Request a callback' }).click()
  await expect(page.getByRole('dialog', { name: 'Book your move' }).getByRole('alert')).toContainText('Save failed')
  expect((await state(request)).estimates).toBe(0)
  await page.getByRole('button', { name: 'Request a callback' }).click()
  await expect(page.getByRole('heading', { name: 'Callback request recorded' })).toBeVisible()
  const data = await state(request)
  expect(data.estimates).toBe(1)
  expect(data.requests.filter((entry) => entry.path === '/api/price')).toHaveLength(1)
  expect(data.requests.filter((entry) => entry.path === '/api/estimates')).toHaveLength(2)
  expect(data.requests.filter((entry) => entry.method === 'PATCH')).toHaveLength(1)
})

test('reload during committed save retains unknown outcome and never offers blind retry', async ({ page, request }) => {
  await ready(page)
  await booking(page)
  await gate(request, 'after:POST /api/estimates')
  await page.getByRole('button', { name: 'Request a callback' }).click()
  await entered(request, 'after:POST /api/estimates')
  expect((await state(request)).estimates).toBe(1)
  expect(
    Object.values((await session(page)).operations).some((op) => op.request.kind === 'save' && op.status === 'pending'),
  ).toBe(true)
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: 'Save interrupted' })).toContainText('unknown outcome')
  await expect(page.getByRole('button', { name: 'Retry save' })).toHaveCount(0)
  await priceButton(page).click()
  await expect(page.getByRole('button', { name: 'Start a new session' })).toBeDisabled()
  await gate(request, 'after:POST /api/estimates', true)
  await expect
    .poll(async () => (await state(request)).requests.filter((entry) => entry.path === '/api/estimates').length)
    .toBe(1)
})

test('conversation snapshot omits receipts/image URLs while exposing accepted structured inventory', async ({
  page,
}) => {
  await openPhotos(page)
  await upload(page, [0])
  const response = await send(page, 'What is missing?')
  expect(response.status()).toBe(200)
  const snapshot = response.request().postDataJSON().snapshot
  const text = JSON.stringify(snapshot)
  for (const photo of (await session(page)).photos) {
    expect(text).not.toContain(photo.receipt)
    expect(text).not.toContain(photo.url)
  }
  expect(snapshot.photos[0]).toEqual({ id: expect.any(String), status: 'relevant', decision: null })
  expect(snapshot.inventory).toContainEqual({ type: 'sofa', count: 2 })
  expect(Object.keys(snapshot)).not.toContain('contact')
})
