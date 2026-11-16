import { afterEach, expect, it, vi } from 'vitest'
import { runText, runVision } from '../functions/api/_lib/ai-client'
import type { Bindings } from '../functions/api/_lib/types'

const model = '@cf/deepseek-ai/deepseek-v4.1-flash-1017'
const env = (extra: object) => ({ ENV: 'development', CHAT_MODEL: model, AI_MODE: 'binding', ...extra }) as Bindings
const mock = () => 'offline'
afterEach(() => vi.unstubAllGlobals())
it('uses a bounded nonreasoning completion profile only for exact optional DeepSeek Chat binding', async () => {
  const run = vi.fn(async () => ({ choices: [{ message: { content: 'visible' } }] }))
  await runText(env({ AI: { run } }), 'synthetic', mock)
  expect(run).toHaveBeenLastCalledWith(model, {
    messages: [{ role: 'user', content: 'synthetic' }],
    max_completion_tokens: 2048,
    reasoning_effort: 'none',
  })
  await runText(env({ AI: { run }, PRICE_MODEL: model }), 'synthetic', mock, 'price')
  expect(run.mock.calls.at(-1)?.[1]).toEqual({ messages: [{ role: 'user', content: 'synthetic' }], max_tokens: 2048 })
  await runText(env({ AI: { run }, CHAT_MODEL: `${model}-other` }), 'synthetic', mock)
  expect(run.mock.calls.at(-1)?.[1]).toHaveProperty('max_tokens', 2048)
  await runVision(
    env({ AI: { run }, VISION_MODEL: model }),
    'synthetic',
    [{ data: new Uint8Array([1]), mimeType: 'image/jpeg' }],
    mock,
  )
  expect(run.mock.calls.at(-1)?.[1]).toHaveProperty('max_tokens', 2048)
})
it('serializes supported providerOptions through the installed Gateway adapter into the actual request body', async () => {
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body))
      return Response.json({
        id: 'test',
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'visible' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })
    }),
  )
  expect(await runText(env({ AI_MODE: 'gateway', CF_AIG_TOKEN: 'synthetic' }), 'synthetic', mock)).toEqual({
    text: 'visible',
    mode: 'gateway',
  })
  expect(bodies).toHaveLength(1)
  expect(bodies[0]).toMatchObject({ model, max_completion_tokens: 2048, reasoning_effort: 'none' })
  expect(bodies[0]).not.toHaveProperty('max_tokens')
})
it('keeps the optional model profile behind forced mock with zero provider calls', async () => {
  const run = vi.fn()
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  expect(await runText(env({ AI: { run }, AI_MODE: 'mock' }), 'synthetic', mock)).toEqual({
    text: 'offline',
    mode: 'mock',
  })
  expect(run).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
