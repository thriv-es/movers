import {
  test,
  expect,
  openPhotos,
  upload,
  analyze,
  photos,
  session,
  priceButton,
  expectPriceBlocked,
  manifestPanel,
  review,
  state,
  writes,
  send,
  gate,
  entered,
} from './fixtures.mjs'

// Real local routes/D1/R2, scripted provider verdicts; NOT JPEG semantic ground truth.
test('one mounted conversation: ten receipts, review, explicit price/save/date and chosen quotes', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 917, height: 987 })
  await page.goto('/estimate')
  const composer = await page.getByRole('textbox', { name: 'Message', exact: true }).elementHandle()
  const log = await page.getByRole('log').elementHandle()
  if (!composer || !log) throw new Error('Initial composer and conversation log must be mounted')
  const expectMounted = async () => {
    expect(await composer.evaluate((node) => node === document.querySelector('#conversation-message'))).toBe(true)
    expect(await log.evaluate((node) => node === document.querySelector('[role="log"]'))).toBe(true)
  }
  await send(page, 'from Tel Aviv to Raanana on 1.1.2027')
  await expect(page.getByLabel('Moving from', { exact: true })).toHaveValue('Tel Aviv')
  await expectMounted()
  await send(page, '15 miles')
  await expectMounted()
  await page.getByRole('button', { name: 'Review move details', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm move details', exact: true }).click()
  await expect(page.getByRole('button', { name: /Move details confirmed · Reopen details/ })).toBeVisible()
  await expectMounted()
  await upload(page, [9, 0, 7, 2, 8, 5, 1, 6, 4, 3])
  await expectMounted()
  const response = await analyze(page)
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
  await expect(page.getByLabel('Add something we missed')).toBeDisabled()
  // Bind each decision to a known source filename and its accepted local photo ID, never completion order.
  const uploaded = await session(page)
  const keptPhoto = uploaded.photos.find((photo) => new URL(photo.url).pathname.endsWith(photos[9].file))
  const excludedPhoto = uploaded.photos.find((photo) => new URL(photo.url).pathname.endsWith(photos[8].file))
  if (!keptPhoto || !excludedPhoto) throw new Error('Both declared uncertain fixture sources must be uploaded')
  expect(keptPhoto.id).not.toBe(excludedPhoto.id)
  const photoCard = (photo) =>
    page
      .getByRole('list', { name: 'Selected photos' })
      .getByRole('listitem')
      .filter({ has: page.locator(`img[src="${photo.url}"]`) })
  await photoCard(keptPhoto)
    .getByRole('button', { name: /^Keep photo / })
    .click()
  await expectPriceBlocked(page)
  await photoCard(excludedPhoto)
    .getByRole('button', { name: /^Exclude photo / })
    .click()
  expect((await session(page)).photoDecisions).toEqual({ [keptPhoto.url]: 'keep', [excludedPhoto.url]: 'exclude' })
  await expectMounted()
  await expect(page.getByLabel('Add something we missed')).toBeEnabled()
  await review(page, { duplicates: [{ item: 'sofa', count: 2, resolution: 'same' }] })
  expect((await session(page)).duplicateResolutions).toEqual({ sofa: 'same' })
  await expectMounted()
  expect(writes(await state(request))).toEqual([])
  await expect(priceButton(page)).toBeEnabled()
  const priced = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/price')
  const saved = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/estimates' && r.request().method() === 'POST',
  )
  await priceButton(page).click()
  expect((await priced).status()).toBe(200)
  expect((await saved).status()).toBe(201)
  await expect(page.getByRole('button', { name: /View estimate/ })).toContainText('Saved reference')
  const sent = (await priced).request().postDataJSON()
  // Independent oracle from the declared provider script: #10 bookshelf is kept; #9 armchair and #7/#8 are excluded.
  const expectedPricedItems = [
    { type: 'bed', count: 1 },
    { type: 'bookshelf', count: 1 },
    { type: 'desk', count: 1 },
    { type: 'dining table', count: 1 },
    { type: 'microwave', count: 1 },
    { type: 'sofa', count: 1 },
    { type: 'tool chest', count: 1 },
  ]
  expect([...sent.analysis.items].sort((a, b) => a.type.localeCompare(b.type))).toEqual(expectedPricedItems)
  for (const excludedType of ['armchair', 'unrelated beach umbrella', 'unrelated food platter'])
    expect(sent.analysis.items.some((item) => item.type === excludedType)).toBe(false)
  expect(sent.analysis.totalVolumeCubicFeet).toBe(140)
  expect(sent.analysis.possibleDuplicates).toEqual([{ item: 'sofa', count: 2 }])
  expect(sent.review).toEqual({
    followUps: { garage: false, closets: false, appliances: false },
    wholeMoveCovered: true,
    photoEvidence: { excludedCount: 3, unresolvedCount: 0 },
  })
  await expectMounted()
  await expect(page.getByLabel('Preferred move date')).toHaveValue('2027-01-01')
  await page.getByLabel('Your name', { exact: true }).fill('Synthetic Browser')
  await page.getByLabel('Email', { exact: true }).fill('browser@example.invalid')
  await page.getByLabel('Phone', { exact: true }).fill('2025550100')
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Preserved composer draft')
  expect(writes(await state(request))).toHaveLength(2)
  const dated = page.waitForResponse((r) => r.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Request this date', exact: true }).click()
  expect((await dated).status()).toBe(200)
  await expect(page.getByRole('region', { name: 'Date request' })).toContainText('not a confirmed booking or dispatch')
  await page.getByRole('button', { name: 'Choose movers', exact: true }).click()
  const chosen = page.getByRole('checkbox', { name: /Synthetic Fixture Movers a/ })
  await expect(chosen).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: /Synthetic Fixture Movers b/ })).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Send quote requests', exact: true })).toBeDisabled()
  await chosen.check()
  await page.getByLabel('A note for the movers').fill('Synthetic note')
  const quoted = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/quote-requests')
  await page.getByRole('button', { name: 'Send quote requests', exact: true }).click()
  const quoteResponse = await quoted
  expect(quoteResponse.status()).toBe(201)
  expect(quoteResponse.request().postDataJSON().moverIds).toEqual(['e2e-mover-a'])
  await expect(page.getByRole('region', { name: 'Mover quote requests' })).toContainText(
    'recorded for Synthetic Fixture Movers a',
  )
  await expectMounted()
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Preserved composer draft')
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
  }).toEqual({ receipts: 10, objects: 10, estimates: 1, quotes: 1, logs: 1 })
  expect(
    before.requests
      .filter((entry) => entry.path.startsWith('/api/images/') && entry.method === 'GET')
      .every((entry) => entry.status === 200),
  ).toBe(true)
  const durable = await session(page)
  expect(durable.duplicateResolutions).toEqual({ sofa: 'same' })
  expect([...durable.items].sort((a, b) => a.type.localeCompare(b.type))).toEqual(expectedPricedItems)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Date request' })).toContainText('Requested 2027-01-01')
  await expect(page.getByRole('region', { name: 'Mover quote requests' })).toContainText('recorded for')
  expect((await session(page)).photoDecisions).toEqual(durable.photoDecisions)
  expect((await session(page)).followUps).toEqual(durable.followUps)
  expect((await session(page)).duplicateResolutions).toEqual({ sofa: 'same' })
  expect([...(await session(page)).items].sort((a, b) => a.type.localeCompare(b.type))).toEqual(expectedPricedItems)
  await page.getByRole('button', { name: /Reopen review/ }).click()
  await expect(page.getByText('Answered: same', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^(Same|Different) sofa$/ })).toHaveCount(0)
  expect(writes(await state(request))).toEqual(writes(before))
})

test('uncertain-only candidates require Keep before accepted inventory and complete review', async ({ page }) => {
  await openPhotos(page)
  await upload(page, [8])
  const response = await analyze(page)
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result.items).toEqual([])
  expect(result.totalVolumeCubicFeet).toBe(0)
  expect(result.estimatedBoxes).toEqual({ min: 0, max: 0 })
  await expectPriceBlocked(page)
  await expect(page.getByLabel('Add something we missed')).toBeDisabled()
  await page.getByRole('button', { name: 'Keep photo 1', exact: true }).click()
  await expect(manifestPanel(page)).toContainText('armchair')
  await review(page, { duplicates: [] })
  await expect(priceButton(page)).toBeEnabled()
})

test('excluding every uncertain photo blocks empty pricing across reload; explicit added item recovers', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  await upload(page, [8, 9])
  expect((await analyze(page)).status()).toBe(200)
  await page.getByRole('button', { name: 'Exclude photo 1', exact: true }).click()
  await page.getByRole('button', { name: 'Exclude photo 2', exact: true }).click()
  await review(page, { duplicates: [] })
  await expectPriceBlocked(page)
  await page.reload()
  await expect(manifestPanel(page)).toContainText('No accepted inventory remains.')
  await expectPriceBlocked(page)
  expect(writes(await state(request))).toEqual([])
  await page.getByLabel('Add something we missed').fill('fixture trunk')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(priceButton(page)).toBeEnabled()
})

test('a different session cannot analyze a valid upload receipt', async ({ page, request }) => {
  await openPhotos(page)
  await upload(page, [0])
  const draft = await session(page)
  const response = await request.post('/api/analyze', {
    data: { sessionId: crypto.randomUUID(), photoRefs: draft.photoRefs, moveDetails: draft.moveDetails },
  })
  expect(response.status()).toBe(400)
  const body = await response.json()
  expect(body.code).toBe('NO_USABLE_PHOTOS')
  expect(body.photoAssessments[0].status).toBe('unlinked')
  expect((await state(request)).calls).toEqual([])
  expect((await analyze(page)).status()).toBe(200)
})

test('stale vision fingerprint rejects real pricing without restoring old analysis on reload', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  await upload(page, [0])
  expect((await analyze(page)).status()).toBe(200)
  await review(page, { duplicates: [{ item: 'sofa', count: 2, resolution: 'same' }] })
  const draft = await session(page)
  expect((await request.post('/__e2e/change-vision')).ok()).toBe(true)
  const response = await request.post('/api/price', {
    data: { analysis: draft.analysis, moveDetails: draft.moveDetails },
  })
  expect(response.status()).toBe(409)
  expect((await response.json()).code).toBe('REANALYZE_REQUIRED')
  await page.reload()
  await priceButton(page).click()
  await expect(page.getByRole('alert')).toContainText('Analyze your photos again')
  expect((await state(request)).estimates).toBe(0)
})

for (const scenario of ['retry-once', 'malformed', 'provider-failure']) {
  test(`${scenario}: real assessment retry and failure boundaries`, async ({ page, request }) => {
    await request.post('/__e2e/scenario', { data: { name: scenario } })
    await openPhotos(page)
    await upload(page, [2])
    const response = await analyze(page)
    expect(response.status()).toBe(scenario === 'retry-once' ? 200 : scenario === 'malformed' ? 400 : 503)
    const data = await state(request)
    expect(data.calls).toHaveLength(scenario === 'provider-failure' ? 1 : 2)
    if (scenario === 'retry-once') await expect(manifestPanel(page)).toContainText('desk')
    else {
      await expect(page.getByRole('region', { name: 'Conversation photos' })).toBeVisible()
      await expect(
        page.getByRole('alert').filter({ hasText: 'Analysis failed. Your conversation is safe; retry explicitly.' }),
      ).toBeVisible()
      await expect(page.getByRole('region', { name: 'Conversation photos' }).getByRole('alert')).toContainText(
        'Re-upload failed or unavailable photos',
      )
      expect((await session(page)).analysis).toBeNull()
      expect(writes(data)).toEqual([])
      if (scenario === 'malformed') expect((await response.json()).code).toBe('ANALYSIS_FAILED')
    }
  })
}

test('unrelated-only photos remain rejected without usable inventory', async ({ page }) => {
  await openPhotos(page)
  await upload(page, [6, 7])
  const response = await analyze(page)
  expect(response.status()).toBe(400)
  expect((await response.json()).code).toBe('NO_USABLE_PHOTOS')
  await expectPriceBlocked(page)
})

test('reset removes local receipts, objects and synthetic leads', async ({ page, request }) => {
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

test('v5 receipt-backed draft migrates without invented confirmation or writes', async ({ page, request }) => {
  await openPhotos(page)
  await upload(page, [2])
  await analyze(page)
  const draft = await session(page)
  await page.evaluate(
    (value) => sessionStorage.setItem('movers.estimate', JSON.stringify({ ...value, version: 5, step: 'estimate' })),
    draft,
  )
  await page.reload()
  await expect(page.getByRole('log')).toContainText('Your earlier draft is here')
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
    expect((await session(page)).photos.every((photo) => photo.receipt)).toBe(true)
    expect((await analyze(page)).status()).toBe(200)
  })
}

test('unrelated panel edit rejects an old upload cohort', async ({ page, request }) => {
  await openPhotos(page)
  const key = `upload:${photos[0].file}`
  await gate(request, key)
  await page.getByLabel('Choose from library', { exact: true }).setInputFiles(photos[0].path)
  await entered(request, key)
  await page.getByLabel('Moving from', { exact: true }).fill('Edited origin')
  await gate(request, key, true)
  await expect(page.getByText('Upload failed — not linked')).toBeVisible()
  expect((await session(page)).photos).toEqual([])
})

for (const boundary of ['preflight', 'price', 'analysis']) {
  test(`attachment/edit during held ${boundary} rejects dependent stale work`, async ({ page, request }) => {
    await openPhotos(page)
    await upload(page, [0])
    if (boundary !== 'analysis') {
      await analyze(page)
      await review(page, { duplicates: [{ item: 'sofa', count: 2, resolution: 'same' }] })
    }
    const key =
      boundary === 'preflight'
        ? 'after:GET /api/ai-status'
        : boundary === 'price'
          ? 'after:POST /api/price'
          : 'after:POST /api/analyze'
    await gate(request, key)
    if (boundary === 'analysis') await page.getByRole('button', { name: /^Analyse / }).click()
    else await priceButton(page).click()
    await entered(request, key)
    if (boundary === 'analysis')
      await page.getByLabel('Moving from', { exact: true }).fill('Changed while analysis pending')
    else {
      const uploadKey = `upload:${photos[1].file}`
      await gate(request, uploadKey)
      page.once('dialog', (dialog) => dialog.accept())
      await page.getByLabel('Choose from library', { exact: true }).setInputFiles(photos[1].path)
      await entered(request, uploadKey)
    }
    await gate(request, key, true)
    await expect(page.getByRole('alert')).toContainText(
      boundary === 'analysis' ? 'stale or not ready' : 'pending uploads',
    )
    await expect
      .poll(async () => Object.values((await session(page)).operations).filter((op) => op.status === 'pending').length)
      .toBe(0)
    if (boundary !== 'analysis')
      await expect(
        page.getByRole('button', {
          name: boundary === 'price' ? 'Retry save' : 'Confirm inventory and get estimate',
          exact: true,
        }),
      ).toBeDisabled()
    const data = await state(request)
    expect(data.estimates).toBe(0)
    expect(data.requests.filter((entry) => entry.path === '/api/price')).toHaveLength(boundary === 'price' ? 1 : 0)
    if (boundary === 'analysis') expect((await session(page)).analysis).toBeNull()
  })
}

test('save failure retries only save rather than repricing', async ({ page, request }) => {
  await openPhotos(page)
  await upload(page, [2])
  await analyze(page)
  await review(page, { duplicates: [] })
  await request.post('/__e2e/scenario', { data: { name: 'normal', saveFailures: 1 } })
  await priceButton(page).click()
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeEnabled()
  expect((await state(request)).estimates).toBe(0)
  await page.getByRole('button', { name: 'Retry save', exact: true }).click()
  await expect(page.getByRole('button', { name: /View estimate/ })).toContainText('Saved reference')
  expect((await state(request)).estimates).toBe(1)
  expect((await state(request)).requests.filter((entry) => entry.path === '/api/price')).toHaveLength(1)
  expect((await state(request)).requests.filter((entry) => entry.path === '/api/estimates')).toHaveLength(2)
})

test('reload during committed save preserves unknown outcome and never offers a blind retry', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  await upload(page, [2])
  await analyze(page)
  await review(page, { duplicates: [] })
  await gate(request, 'after:POST /api/estimates')
  await priceButton(page).click()
  await entered(request, 'after:POST /api/estimates')
  expect((await state(request)).estimates).toBe(1)
  expect(
    Object.values((await session(page)).operations).some((op) => op.request.kind === 'save' && op.status === 'pending'),
  ).toBe(true)
  await page.reload()
  const operations = Object.values((await session(page)).operations).map((op) => ({
    kind: op.request.kind,
    status: op.status,
  }))
  await test.info().attach('reload-save-outcomes.json', {
    body: JSON.stringify({ operations, serverEstimates: (await state(request)).estimates }),
    contentType: 'application/json',
  })
  // A committed write with an unread response remains unknown across reload, never a blind retry.
  await expect(page.getByRole('status').filter({ hasText: 'Save interrupted' })).toContainText('unknown outcome')
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toHaveCount(0)
  await gate(request, 'after:POST /api/estimates', true)
  await expect
    .poll(async () => (await state(request)).requests.filter((entry) => entry.path === '/api/estimates').length)
    .toBe(1)
})

test('conversation snapshot omits receipts, image URLs and synthetic contact fields', async ({ page }) => {
  await openPhotos(page)
  await upload(page, [0])
  await analyze(page)
  const response = await send(page, 'What is missing?')
  expect(response.status()).toBe(200)
  const snapshot = response.request().postDataJSON().snapshot
  const text = JSON.stringify(snapshot)
  for (const photo of (await session(page)).photos) {
    expect(text).not.toContain(photo.receipt)
    expect(text).not.toContain(photo.url)
  }
  expect(snapshot.photos[0]).toEqual({ id: expect.any(String), status: 'relevant', decision: null })
  expect(Object.keys(snapshot)).not.toContain('contact')
})
