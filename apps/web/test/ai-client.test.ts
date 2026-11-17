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
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Not logged in'))
  })

  it('treats an empty answer as a failure', async () => {
    const AI = binding(async () => ({ response: '' }))
    expect(await runText(env({ AI }), 'PROMPT', mock)).toEqual({ text: 'MOCK ANSWER', mode: 'mock' })
  })

  it('never falls back to the mock in production', async () => {
    const AI = binding(async () => {
      throw new Error('Workers AI is down')
    })
    await expect(runText(env({ AI, ENV: 'production' }), 'PROMPT', mock)).rejects.toThrow('Workers AI is down')
    await expect(runVision(env({ AI, ENV: 'production' }), 'PROMPT', [image], mock)).rejects.toThrow(
      'Workers AI is down',
    )
    expect(mock).not.toHaveBeenCalled()
  })

  it('does not fall back when the mode is forced', async () => {
    const AI = binding(async () => {
      throw new Error('boom')
    })
    await expect(runText(env({ AI, AI_MODE: 'binding' }), 'PROMPT', mock)).rejects.toThrow('boom')
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
    expect(Object.keys(args).sort()).toEqual(['maxOutputTokens', 'model', 'prompt'])
    expect(args.prompt).toBe('PROMPT')
    expect(args.maxOutputTokens).toBe(2048)
    expect(args.model.modelId).toBe(TEXT_MODEL)
    expect(AI.run).not.toHaveBeenCalled()
  })

  it('caps the output so the JSON session block is not truncated (the gateway default is 256 tokens)', async () => {
    generateTextMock.mockResolvedValue({ text: 'gateway answer' } as never)
    await runText(env({ CF_AIG_TOKEN: 'token' }), 'PROMPT', mock)

    const args = generateTextMock.mock.calls[0]?.[0] as Record<string, any>
    expect(args.maxOutputTokens).toBeGreaterThanOrEqual(2048)
  })

  it('calls generateText once per photo: vision model with one image part', async () => {
    generateTextMock.mockResolvedValue({ text: 'gateway vision' } as never)
    const result = await runVision(env({ CF_AIG_TOKEN: 'token' }), 'PROMPT', [image, image], mock)

    expect(result).toEqual({ texts: ['gateway vision', 'gateway vision'], mode: 'gateway' })
    expect(generateTextMock).toHaveBeenCalledTimes(2)
    const args = generateTextMock.mock.calls[0]?.[0] as Record<string, any>
    expect(Object.keys(args).sort()).toEqual(['maxOutputTokens', 'messages', 'model'])
    expect(args.maxOutputTokens).toBe(2048)
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

  it('rethrows in production and falls back to the mock in development', async () => {
    generateTextMock.mockRejectedValue(new Error('401 Unauthorized'))
    await expect(runText(env({ CF_AIG_TOKEN: 'token', ENV: 'production' }), 'PROMPT', mock)).rejects.toThrow(
      '401 Unauthorized',
    )
    expect(mock).not.toHaveBeenCalled()

    expect(await runText(env({ CF_AIG_TOKEN: 'token' }), 'PROMPT', mock)).toEqual({ text: 'MOCK ANSWER', mode: 'mock' })
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
