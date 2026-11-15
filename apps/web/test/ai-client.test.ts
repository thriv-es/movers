import { generateText } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEXT_MODEL, VISION_MODEL, textModel } from '../functions/api/_lib/ai'
import { runText, runVision } from '../functions/api/_lib/ai-client'
import type { Bindings } from '../functions/api/_lib/types'

vi.mock('ai', () => ({ generateText: vi.fn() }))

const generateTextMock = vi.mocked(generateText)
const mock = vi.fn(() => 'MOCK ANSWER')

function env(overrides: Record<string, unknown>): Bindings {
  return { ENV: 'development', PRICE_PER_BOX: '50', CF_AIG_TOKEN: '', ...overrides } as unknown as Bindings
}

function binding(run: (...args: any[]) => unknown) {
  return { run: vi.fn(run) }
}

const image = { data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg' }

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  generateTextMock.mockReset()
  mock.mockClear()
})

describe('binding mode', () => {
  it('runs the text model through env.AI and reads .response', async () => {
    const AI = binding(async () => ({ response: 'hello from workers ai' }))
    const result = await runText(env({ AI }), 'PROMPT', mock)

    expect(result).toEqual({ text: 'hello from workers ai', mode: 'binding' })
    expect(AI.run).toHaveBeenCalledWith(TEXT_MODEL, {
      messages: [{ role: 'user', content: 'PROMPT' }],
      max_tokens: 2048,
    })
    expect(mock).not.toHaveBeenCalled()
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('runs the vision model once per photo (one image_url data-URL part each) and keeps the order', async () => {
    let calls = 0
    const AI = binding(async () => ({ response: `{"photo":${++calls}}` }))
    const result = await runVision(env({ AI }), 'PROMPT', [image, { ...image, mimeType: 'image/png' }], mock)

    expect(result.mode).toBe('binding')
    expect(result.texts).toEqual(['{"photo":1}', '{"photo":2}'])
    expect(AI.run).toHaveBeenCalledTimes(2)
    expect(AI.run).toHaveBeenNthCalledWith(1, VISION_MODEL, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'PROMPT' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/2Q==' } },
          ],
        },
      ],
      max_tokens: 2048,
    })
    expect(AI.run).toHaveBeenNthCalledWith(2, VISION_MODEL, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'PROMPT' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,/9j/2Q==' } },
          ],
        },
      ],
      max_tokens: 2048,
    })
  })

  it('falls back to a single mock answer for all photos when one photo call fails outside production', async () => {
    let calls = 0
    const AI = binding(async () => {
      if (++calls === 2) throw new Error('photo 2 failed')
      return { response: 'ok' }
    })
    const result = await runVision(env({ AI }), 'PROMPT', [image, image], mock)
    expect(result).toEqual({ texts: ['MOCK ANSWER'], mode: 'mock' })
  })

  it('encodes images larger than one String.fromCharCode chunk', async () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 251)
    const AI = binding(async () => ({ response: 'ok' }))
    await runVision(env({ AI }), 'PROMPT', [{ data: big, mimeType: 'image/jpeg' }], mock)

    const url: string = AI.run.mock.calls[0]?.[1].messages[0].content[1].image_url.url
    const decoded = Uint8Array.from(atob(url.replace('data:image/jpeg;base64,', '')), (c) => c.charCodeAt(0))
    expect(decoded).toEqual(big)
  })

  it('serialises a .response that Workers AI already parsed into an object', async () => {
    const AI = binding(async () => ({ response: { total: 100, breakdown: { a: 100 } } }))
    const result = await runText(env({ AI }), 'PROMPT', mock)
    expect(JSON.parse(result.text)).toEqual({ total: 100, breakdown: { a: 100 } })
  })

  it('falls back to the labelled mock when the call fails outside production', async () => {
    const AI = binding(async () => {
      throw new Error('Not logged in')
    })
    const result = await runText(env({ AI }), 'PROMPT', mock)

    expect(result).toEqual({ text: 'MOCK ANSWER', mode: 'mock' })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('offline mock'))
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('Not logged in'))
  })

  it('treats an empty answer as a failure', async () => {
    const AI = binding(async () => ({ response: '' }))
    expect(await runText(env({ AI }), 'PROMPT', mock)).toEqual({ text: 'MOCK ANSWER', mode: 'mock' })
  })

  it('never falls back to the mock in production', async () => {
    const AI = binding(async () => {
      throw new Error('Workers AI is down')
    })
    await expect(runText(env({ AI, ENV: 'production' }), 'PROMPT', mock)).rejects.toMatchObject({
      message: 'Workers AI binding request failed',
    })
    await expect(runVision(env({ AI, ENV: 'production' }), 'PROMPT', [image], mock)).rejects.toMatchObject({
      message: 'Workers AI binding request failed',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('does not fall back when the mode is forced', async () => {
    const AI = binding(async () => {
      throw new Error('boom')
    })
    await expect(runText(env({ AI, AI_MODE: 'binding' }), 'PROMPT', mock)).rejects.toMatchObject({
      message: 'Workers AI binding request failed',
    })
    await expect(runText(env({ AI_MODE: 'binding' }), 'PROMPT', mock)).rejects.toThrow(/AI binding/)
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('mock mode', () => {
  it('answers from the mock without calling any backend', async () => {
    const AI = binding(async () => ({ response: 'real' }))
    const forced = await runText(env({ AI, AI_MODE: 'mock', CF_AIG_TOKEN: 'token' }), 'PROMPT', mock)
    const auto = await runVision(env({}), 'PROMPT', [image], mock)

    expect(forced).toEqual({ text: 'MOCK ANSWER', mode: 'mock' })
    expect(auto).toEqual({ texts: ['MOCK ANSWER'], mode: 'mock' })
    expect(AI.run).not.toHaveBeenCalled()
    expect(generateTextMock).not.toHaveBeenCalled()
  })
})

describe('gateway mode', () => {
  it('calls generateText exactly as the routes did: text model with the prompt', async () => {
    generateTextMock.mockResolvedValue({ text: 'gateway answer' } as never)
    const AI = binding(async () => ({ response: 'unused' }))
    const result = await runText(env({ CF_AIG_TOKEN: 'token', AI }), 'PROMPT', mock)

    expect(result).toEqual({ text: 'gateway answer', mode: 'gateway' })
    expect(generateTextMock).toHaveBeenCalledTimes(1)
    const args = generateTextMock.mock.calls[0]?.[0] as Record<string, any>
    expect(Object.keys(args).sort()).toEqual(['model', 'prompt'])
    expect(args.prompt).toBe('PROMPT')
    expect(args.model.modelId).toBe(TEXT_MODEL)
    expect(AI.run).not.toHaveBeenCalled()
  })

  it('calls generateText once per photo: vision model with one image part', async () => {
    generateTextMock.mockResolvedValue({ text: 'gateway vision' } as never)
    const result = await runVision(env({ CF_AIG_TOKEN: 'token' }), 'PROMPT', [image, image], mock)

    expect(result).toEqual({ texts: ['gateway vision', 'gateway vision'], mode: 'gateway' })
    expect(generateTextMock).toHaveBeenCalledTimes(2)
    const args = generateTextMock.mock.calls[0]?.[0] as Record<string, any>
    expect(Object.keys(args).sort()).toEqual(['messages', 'model'])
    expect(args.model.modelId).toBe(VISION_MODEL)
    expect(args.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'PROMPT' },
          { type: 'image', image: image.data, mediaType: 'image/jpeg' },
        ],
      },
    ])
  })

  it('reports a safe gateway failure in production and falls back to the mock in development', async () => {
    generateTextMock.mockRejectedValue(new Error('401 Unauthorized'))
    await expect(runText(env({ CF_AIG_TOKEN: 'token', ENV: 'production' }), 'PROMPT', mock)).rejects.toMatchObject({
      message: 'AI Gateway request failed',
    })
    expect(mock).not.toHaveBeenCalled()

    expect(await runText(env({ CF_AIG_TOKEN: 'token' }), 'PROMPT', mock)).toEqual({ text: 'MOCK ANSWER', mode: 'mock' })
  })
})

function settingsDb(revision: number, roles: Record<string, unknown>) {
  const first = vi.fn(async () => ({ revision, roles_json: JSON.stringify(roles) }))
  return { db: { prepare: vi.fn(() => ({ first })) } as unknown as D1Database, first }
}

const selectedRoles = {
  chat: { backend: 'gateway', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
  price: { backend: 'binding', model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast' },
  vision: { backend: 'binding', model: '@cf/meta/llama-3.2-11b-vision-instruct' },
}

describe('local role selections', () => {
  it('routes chat, price, and vision to their independently selected model and backend', async () => {
    generateTextMock.mockResolvedValue({ text: 'chat answer' } as never)
    const AI = binding(async () => ({ response: 'binding answer' }))
    const { db } = settingsDb(1, selectedRoles)
    const local = env({ MOVERS_DB: db, CF_AIG_TOKEN: 'test-token', AI })

    expect(await runText(local, 'CHAT', mock)).toEqual({ text: 'chat answer', mode: 'gateway' })
    expect((generateTextMock.mock.calls[0]?.[0] as any).model.modelId).toBe(selectedRoles.chat.model)
    expect(await runText(local, 'PRICE', mock, 'price')).toEqual({ text: 'binding answer', mode: 'binding' })
    expect(AI.run).toHaveBeenLastCalledWith(selectedRoles.price.model, expect.anything())
    expect(await runVision(local, 'VISION', [image], mock)).toEqual({ texts: ['binding answer'], mode: 'binding' })
    expect(AI.run).toHaveBeenLastCalledWith(selectedRoles.vision.model, expect.anything())
    expect(mock).not.toHaveBeenCalled()
  })

  it('uses the selected vision model on the gateway and reads settings once per vision request', async () => {
    generateTextMock.mockResolvedValue({ text: 'vision answer' } as never)
    const { db, first } = settingsDb(3, { ...selectedRoles, vision: { ...selectedRoles.vision, backend: 'gateway' } })
    const result = await runVision(env({ MOVERS_DB: db, CF_AIG_TOKEN: 'test-token' }), 'VISION', [image, image], mock)
    expect(result).toEqual({ texts: ['vision answer', 'vision answer'], mode: 'gateway' })
    expect(first).toHaveBeenCalledTimes(1)
    expect(generateTextMock.mock.calls.map(([args]) => (args as any).model.modelId)).toEqual([
      selectedRoles.vision.model,
      selectedRoles.vision.model,
    ])
  })

  it('uses a new saved selection on the next call without caching across revisions', async () => {
    const AI = binding(async () => ({ response: 'ok' }))
    const roles = { ...selectedRoles, chat: { backend: 'binding', model: selectedRoles.chat.model } }
    const first = vi.fn(async () => ({ revision: 1, roles_json: JSON.stringify(roles) }))
    const db = { prepare: () => ({ first }) } as unknown as D1Database
    const local = env({ MOVERS_DB: db, AI })
    await runText(local, 'CHAT', mock)
    roles.chat = { backend: 'binding', model: selectedRoles.price.model }
    await runText(local, 'CHAT', mock)
    expect(AI.run.mock.calls.map(([model]) => model)).toEqual([selectedRoles.chat.model, selectedRoles.price.model])
    expect(first).toHaveBeenCalledTimes(2)
  })

  it('keeps forced local mock ahead of a saved real selection without calling providers', async () => {
    const AI = binding(async () => ({ response: 'real' }))
    const { db } = settingsDb(1, selectedRoles)
    const local = env({ MOVERS_DB: db, AI, CF_AIG_TOKEN: 'test-token', AI_MODE: 'mock' })
    expect(await runText(local, 'CHAT', mock)).toEqual({ text: 'MOCK ANSWER', mode: 'mock' })
    expect(await runVision(local, 'VISION', [image], mock)).toEqual({ texts: ['MOCK ANSWER'], mode: 'mock' })
    expect(AI.run).not.toHaveBeenCalled()
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('fails visibly without mock fallback or raw error propagation when a selected provider call fails', async () => {
    const AI = binding(async () => {
      throw new Error('provider failure')
    })
    const { db } = settingsDb(1, selectedRoles)
    await expect(runText(env({ MOVERS_DB: db, AI }), 'PRICE', mock, 'price')).rejects.toMatchObject({
      message: 'Workers AI binding request failed',
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('does not expose sensitive provider exception text from selected Gateway chat or vision', async () => {
    generateTextMock.mockRejectedValue(new Error('SYNTHETIC_TOKEN prompt=private raw_text=untrusted'))
    const { db } = settingsDb(1, { ...selectedRoles, vision: { ...selectedRoles.vision, backend: 'gateway' } })
    const local = env({ MOVERS_DB: db, CF_AIG_TOKEN: 'test-token' })
    await expect(runText(local, 'CHAT', mock)).rejects.toMatchObject({ message: 'AI Gateway request failed' })
    await expect(runVision(local, 'VISION', [image], mock)).rejects.toMatchObject({
      message: 'AI Gateway request failed',
    })
    expect(mock).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('answers forced offline mock when the local settings table read fails', async () => {
    const db = {
      prepare: () => {
        throw new Error('no such table: ai_settings')
      },
    } as unknown as D1Database
    const local = env({ MOVERS_DB: db, AI_MODE: 'mock' })
    expect(await runText(local, 'CHAT', mock)).toEqual({ text: 'MOCK ANSWER', mode: 'mock' })
    expect(await runVision(local, 'VISION', [image], mock)).toEqual({ texts: ['MOCK ANSWER'], mode: 'mock' })
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('fails with a sanitized availability error for a missing selected binding or placeholder token', async () => {
    const { db } = settingsDb(1, selectedRoles)
    await expect(runText(env({ MOVERS_DB: db }), 'PRICE', mock, 'price')).rejects.toThrow(
      'Workers AI binding unavailable',
    )
    await expect(
      runText(env({ MOVERS_DB: db, CF_AIG_TOKEN: 'your_cloudflare_ai_gateway_token_here' }), 'CHAT', mock),
    ).rejects.toThrow('AI Gateway unavailable')
    expect(mock).not.toHaveBeenCalled()
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('ignores the saved local settings in preview and retains environment model routing', async () => {
    const AI = binding(async () => ({ response: 'preview answer' }))
    const { db, first } = settingsDb(1, selectedRoles)
    const result = await runText(
      env({ ENV: 'preview', MOVERS_DB: db, AI, PRICE_MODEL: 'preview-price' }),
      'PRICE',
      mock,
      'price',
    )
    expect(result).toEqual({ text: 'preview answer', mode: 'binding' })
    expect(AI.run).toHaveBeenCalledWith('preview-price', expect.anything())
    expect(first).not.toHaveBeenCalled()
  })
})

describe('model selection', () => {
  it('uses CHAT_MODEL for chat turns and PRICE_MODEL for pricing, falling back to TEXT_MODEL', async () => {
    const AI = binding(async () => ({ response: 'ok' }))
    const cheap = '@cf/meta/llama-3.1-8b-instruct-fp8-fast'

    await runText(env({ AI, CHAT_MODEL: cheap }), 'PROMPT', mock)
    expect(AI.run).toHaveBeenLastCalledWith(cheap, expect.anything())

    await runText(env({ AI, CHAT_MODEL: cheap }), 'PROMPT', mock, 'price')
    expect(AI.run).toHaveBeenLastCalledWith(TEXT_MODEL, expect.anything())

    await runText(env({ AI, PRICE_MODEL: cheap }), 'PROMPT', mock, 'price')
    expect(AI.run).toHaveBeenLastCalledWith(cheap, expect.anything())

    await runText(env({ AI, CHAT_MODEL: '   ' }), 'PROMPT', mock)
    expect(AI.run).toHaveBeenLastCalledWith(TEXT_MODEL, expect.anything())
  })

  it('resolves the model without env vars', () => {
    expect(textModel({}, 'chat')).toBe(TEXT_MODEL)
    expect(textModel({ PRICE_MODEL: 'x' }, 'chat')).toBe(TEXT_MODEL)
    expect(textModel({ PRICE_MODEL: 'x' }, 'price')).toBe('x')
  })
})
