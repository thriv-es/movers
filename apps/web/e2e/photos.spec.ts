import { test, expect, openPhotos, upload, analyze, photos, session } from './fixtures.mjs'

// Scripted verdicts test application behavior, not the semantic accuracy of these JPEGs.
// Regressions caught: accepting uncertain candidates silently, including unrelated inventory,
// bypassing session receipts/fingerprints, unbounded format retries, and pricing empty inventory.
test('all ten original JPEGs upload, mixed exclusions stay out of priced inventory', async ({ page, request }) => {
  await openPhotos(page)
  await upload(page, [9, 0, 7, 2, 8, 5, 1, 6, 4, 3])
  const response = await analyze(page)
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result.photoLinkStatuses.map((photo) => photo.status)).toEqual(Array(10).fill('eligible'))
  expect(result.photoAssessments.map((photo) => photo.status)).toEqual([
    'uncertain',
    'relevant',
    'unrelated',
    'relevant',
    'uncertain',
    'relevant',
    'relevant',
    'unrelated',
    'relevant',
    'relevant',
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
  await expect(page.getByRole('button', { name: /Confirm and price/i })).toBeDisabled()
  await expect(page.getByLabel('Add something we missed')).toBeDisabled()
  await page.getByRole('button', { name: 'Keep photo 1', exact: true }).click()
  await expect(page.getByRole('button', { name: /Confirm and price/i })).toBeDisabled()
  await page.getByRole('button', { name: 'Exclude photo 5', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Detected items' })).toContainText('Bookshelf')
  await expect(page.getByRole('list', { name: 'Detected items' })).not.toContainText('Armchair')
  const priced = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/price')
  const saved = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/estimates' && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: /Confirm and price/i }).click()
  expect((await priced).status()).toBe(200)
  expect((await saved).status()).toBe(201)
  await expect(page.getByRole('region', { name: 'Your estimate', exact: true })).toContainText('$650')
  const state = await (await request.get('/__e2e/state')).json()
  expect(state.uploads.map((upload) => upload.file).sort()).toEqual(photos.map((photo) => photo.file).sort())
  expect(state.uploads.every((upload) => upload.bytes > 1000 && /^[a-f0-9]{64}$/.test(upload.hash))).toBe(true)
  expect(new Set(state.uploads.map((upload) => upload.hash)).size).toBe(10)
  expect(state.calls.map((call) => call.hash).sort()).toEqual(state.uploads.map((upload) => upload.hash).sort())
  expect({ receipts: state.receipts, objects: state.objects, estimates: state.estimates }).toEqual({
    receipts: 10,
    objects: 10,
    estimates: 1,
  })
  expect(
    state.requests
      .filter((entry) => entry.path.startsWith('/api/images/') && entry.method === 'GET')
      .every((entry) => entry.status === 200),
  ).toBe(true)
  const sent = (await priced).request().postDataJSON()
  expect(sent.analysis.totalVolumeCubicFeet).toBe(140)
  expect(sent.review.photoEvidence).toEqual({ excludedCount: 3, unresolvedCount: 0 })
})

test('uncertain-only candidates require Keep before inventory and pricing', async ({ page }) => {
  await openPhotos(page)
  await upload(page, [8])
  const response = await analyze(page)
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result.items).toEqual([])
  expect(result.totalVolumeCubicFeet).toBe(0)
  expect(result.estimatedBoxes).toEqual({ min: 0, max: 0 })
  await expect(page.getByRole('button', { name: /Confirm and price/i })).toBeDisabled()
  await expect(page.getByLabel('Add something we missed')).toBeDisabled()
  await page.getByRole('button', { name: 'Keep photo 1', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Detected items' })).toContainText('Armchair')
  await expect(page.getByRole('button', { name: /Confirm and price/i })).toBeEnabled()
  await expect(page.getByLabel('Add something we missed')).toBeEnabled()
})

test('excluding every uncertain photo blocks empty pricing, including a restored Estimate step', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  await upload(page, [8, 9])
  expect((await analyze(page)).status()).toBe(200)
  await page.getByRole('button', { name: 'Exclude photo 1', exact: true }).click()
  await page.getByRole('button', { name: 'Exclude photo 2', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Detected items' }).getByRole('listitem')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Confirm and price/i })).toBeDisabled()
  await page.evaluate(() => {
    const draft = JSON.parse(sessionStorage.getItem('movers.estimate') ?? 'null')
    sessionStorage.setItem('movers.estimate', JSON.stringify({ ...draft, step: 'estimate' }))
  })
  await page.reload()
  await expect(page.getByText('No accepted inventory remains.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Back to Review', exact: true }).click()
  await expect(page.getByRole('button', { name: /Confirm and price/i })).toBeDisabled()
  const state = await (await request.get('/__e2e/state')).json()
  expect(state.requests.filter((entry) => entry.path === '/api/price')).toEqual([])
  expect(state.estimates).toBe(0)
  await page.getByLabel('Add something we missed').fill('fixture trunk')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: /Confirm and price/i })).toBeEnabled()
})

test('a different session cannot analyze a valid upload receipt', async ({ page, request }) => {
  await openPhotos(page)
  await upload(page, [0])
  const draft = await session(page)
  const result = await page.evaluate(async (draft) => {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: crypto.randomUUID(),
        photoRefs: draft.photoRefs,
        moveDetails: draft.moveDetails,
      }),
    })
    return { status: response.status, body: await response.json() }
  }, draft)
  expect(result.status).toBe(400)
  expect(result.body.code).toBe('NO_USABLE_PHOTOS')
  expect(result.body.photoAssessments[0].status).toBe('unlinked')
  expect((await (await request.get('/__e2e/state')).json()).calls).toEqual([])
  expect((await analyze(page)).status()).toBe(200)
})

test('stale vision fingerprint rejects real pricing and returns restored Review to Photos', async ({
  page,
  request,
}) => {
  await openPhotos(page)
  await upload(page, [0])
  expect((await analyze(page)).status()).toBe(200)
  const draft = await session(page)
  expect((await request.post('/__e2e/change-vision')).ok()).toBe(true)
  const response = await request.post('/api/price', {
    data: { analysis: draft.analysis, moveDetails: draft.moveDetails },
  })
  expect(response.status()).toBe(409)
  expect((await response.json()).code).toBe('REANALYZE_REQUIRED')
  await page.reload()
  await expect(page.getByRole('region', { name: 'Photos', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Analyze your photos again')
  expect((await session(page)).analysis).toBeNull()
  expect((await (await request.get('/__e2e/state')).json()).estimates).toBe(0)
})

for (const scenario of ['retry-once', 'malformed', 'provider-failure']) {
  test(`${scenario}: real assessment retry and failure boundaries`, async ({ page, request }) => {
    expect((await request.post('/__e2e/scenario', { data: { name: scenario } })).ok()).toBe(true)
    await openPhotos(page)
    await upload(page, [2])
    const response = await analyze(page)
    expect(response.status()).toBe(scenario === 'retry-once' ? 200 : scenario === 'malformed' ? 400 : 503)
    const state = await (await request.get('/__e2e/state')).json()
    expect(state.calls).toHaveLength(scenario === 'provider-failure' ? 1 : 2)
    if (scenario === 'retry-once')
      await expect(page.getByRole('list', { name: 'Detected items' })).toContainText('Desk')
    else {
      await expect(page.getByRole('region', { name: 'Photos', exact: true })).toBeVisible()
      await expect(page.getByRole('alert')).toBeVisible()
      expect((await session(page)).analysis).toBeNull()
      expect(state.requests.filter((entry) => entry.path === '/api/price')).toEqual([])
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
  await expect(page.getByRole('region', { name: 'Photos', exact: true })).toBeVisible()
})

test('reset removes local receipts, objects and synthetic leads', async ({ page, request }) => {
  await openPhotos(page)
  await upload(page, [0])
  expect((await request.post('/__e2e/reset')).ok()).toBe(true)
  const state = await (await request.get('/__e2e/state')).json()
  expect({
    receipts: state.receipts,
    objects: state.objects,
    estimates: state.estimates,
    uploads: state.uploads,
    calls: state.calls,
  }).toEqual({ receipts: 0, objects: 0, estimates: 0, uploads: [], calls: [] })
})
