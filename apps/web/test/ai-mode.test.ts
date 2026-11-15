import { describe, expect, it, vi } from 'vitest'
import { resolveAiMode, resolveRole } from '../functions/api/_lib/ai-mode'
import type { Bindings } from '../functions/api/_lib/types'

const TOKEN = 'cf-aig-real-token'
const PLACEHOLDER = 'your_cloudflare_ai_gateway_token_here'
const AI = { run: async () => ({ response: '' }) }

const GATEWAY_NO_FALLBACK = { mode: 'gateway', allowMockFallback: false }

describe('resolveAiMode', () => {
  describe('auto (AI_MODE unset)', () => {
    it('token set: gateway; mock fallback only in local development', () => {
      expect(resolveAiMode({ CF_AIG_TOKEN: TOKEN, AI, ENV: 'development' })).toEqual({
        mode: 'gateway',
        allowMockFallback: true,
      })
      expect(resolveAiMode({ CF_AIG_TOKEN: TOKEN, ENV: 'preview' })).toEqual(GATEWAY_NO_FALLBACK)
      expect(resolveAiMode({ CF_AIG_TOKEN: TOKEN, AI, ENV: 'production' })).toEqual(GATEWAY_NO_FALLBACK)
      expect(resolveAiMode({ CF_AIG_TOKEN: TOKEN })).toEqual(GATEWAY_NO_FALLBACK)
    })

    it('no token, AI binding: binding; mock fallback only in local development', () => {
      expect(resolveAiMode({ AI, ENV: 'development' })).toEqual({ mode: 'binding', allowMockFallback: true })
      expect(resolveAiMode({ AI, ENV: 'preview' })).toEqual({ mode: 'binding', allowMockFallback: false })
      expect(resolveAiMode({ AI })).toEqual({ mode: 'binding', allowMockFallback: false })
      expect(resolveAiMode({ CF_AIG_TOKEN: '', AI, ENV: 'production' })).toEqual({
        mode: 'binding',
        allowMockFallback: false,
      })
    })

    it('no token, no binding, local development: mock', () => {
      expect(resolveAiMode({ ENV: 'development' })).toEqual({ mode: 'mock', allowMockFallback: false })
    })

    it('no token, no binding, anywhere else: gateway and never the mock', () => {
      expect(resolveAiMode({ ENV: 'production' })).toEqual(GATEWAY_NO_FALLBACK)
      expect(resolveAiMode({ ENV: 'preview' })).toEqual(GATEWAY_NO_FALLBACK)
      expect(resolveAiMode({})).toEqual(GATEWAY_NO_FALLBACK)
    })
  })

  describe('forced AI_MODE', () => {
    it('gateway is used as forced, without fallback', () => {
      expect(resolveAiMode({ AI_MODE: 'gateway', AI, ENV: 'development' })).toEqual(GATEWAY_NO_FALLBACK)
    })

    it('binding is used as forced, without fallback', () => {
      expect(resolveAiMode({ AI_MODE: 'binding', CF_AIG_TOKEN: TOKEN, ENV: 'development' })).toEqual({
        mode: 'binding',
        allowMockFallback: false,
      })
    })

    it('mock is used as forced in local development only', () => {
      expect(resolveAiMode({ AI_MODE: 'mock', CF_AIG_TOKEN: TOKEN, AI, ENV: 'development' })).toEqual({
        mode: 'mock',
        allowMockFallback: false,
      })
    })

    it('mock is ignored outside local development, as if AI_MODE were unset', () => {
      expect(resolveAiMode({ AI_MODE: 'mock', ENV: 'production' })).toEqual(GATEWAY_NO_FALLBACK)
      expect(resolveAiMode({ AI_MODE: 'mock', AI, ENV: 'preview' })).toEqual({
        mode: 'binding',
        allowMockFallback: false,
      })
      expect(resolveAiMode({ AI_MODE: 'mock' })).toEqual(GATEWAY_NO_FALLBACK)
    })
  })

  it('treats the placeholder token as unset', () => {
    expect(resolveAiMode({ CF_AIG_TOKEN: PLACEHOLDER, AI, ENV: 'development' })).toEqual({
      mode: 'binding',
      allowMockFallback: true,
    })
    expect(resolveAiMode({ CF_AIG_TOKEN: PLACEHOLDER, ENV: 'development' })).toEqual({
      mode: 'mock',
      allowMockFallback: false,
    })
  })

  it('reads AI_MODE case-insensitively', () => {
    expect(resolveAiMode({ AI_MODE: 'MOCK', CF_AIG_TOKEN: TOKEN, AI, ENV: 'development' })).toEqual({
      mode: 'mock',
      allowMockFallback: false,
    })
    expect(resolveAiMode({ AI_MODE: ' Binding ', CF_AIG_TOKEN: TOKEN })).toEqual({
      mode: 'binding',
      allowMockFallback: false,
    })
  })

  it('treats an unknown AI_MODE as auto', () => {
    expect(resolveAiMode({ AI_MODE: 'turbo', CF_AIG_TOKEN: TOKEN, ENV: 'development' })).toEqual({
      mode: 'gateway',
      allowMockFallback: true,
    })
    expect(resolveAiMode({ AI_MODE: 'auto', AI, ENV: 'production' })).toEqual({
      mode: 'binding',
      allowMockFallback: false,
    })
    expect(resolveAiMode({ AI_MODE: '', ENV: 'development' })).toEqual({ mode: 'mock', allowMockFallback: false })
  })
})

function settingsDb(revision: number, roles: Record<string, unknown>) {
  const first = async () => ({ revision, roles_json: JSON.stringify(roles) })
  const prepare = vi.fn(() => ({ first }))
  return { db: { prepare } as unknown as D1Database, prepare }
}

const roles = {
  chat: { backend: 'gateway', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
  price: { backend: 'binding', model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast' },
  vision: { backend: 'binding', model: '@cf/meta/llama-3.2-11b-vision-instruct' },
}

function roleEnv(overrides: Record<string, unknown>): Bindings {
  return { ENV: 'development', CF_AIG_TOKEN: TOKEN, ...overrides } as unknown as Bindings
}

describe('resolveRole', () => {
  it('keeps the unsaved local auto binding and its environment model instead of defaulting to Gateway', async () => {
    const db = { prepare: () => ({ first: async () => null }) } as unknown as D1Database
    expect(
      await resolveRole(roleEnv({ MOVERS_DB: db, CF_AIG_TOKEN: '', AI, PRICE_MODEL: 'legacy-price' }), 'price'),
    ).toEqual({
      selection: { backend: 'binding', model: 'legacy-price' },
      mode: 'binding',
      available: true,
      revision: 0,
    })
  })

  it('keeps the unsaved local offline mock rather than requiring a Gateway token', async () => {
    const db = { prepare: () => ({ first: async () => null }) } as unknown as D1Database
    expect(await resolveRole(roleEnv({ MOVERS_DB: db, CF_AIG_TOKEN: '' }), 'chat')).toMatchObject({
      mode: 'mock',
      available: true,
      revision: 0,
    })
  })

  it('honors forced legacy AI_MODE=binding before the first save', async () => {
    const db = { prepare: () => ({ first: async () => null }) } as unknown as D1Database
    expect(await resolveRole(roleEnv({ MOVERS_DB: db, AI_MODE: 'binding', AI }), 'chat')).toMatchObject({
      mode: 'binding',
      available: true,
      revision: 0,
    })
  })

  it('resolves each saved role independently with availability and revision', async () => {
    const { db } = settingsDb(4, roles)
    const env = roleEnv({ MOVERS_DB: db, AI })
    expect(await resolveRole(env, 'chat')).toEqual({
      selection: roles.chat,
      mode: 'gateway',
      available: true,
      revision: 4,
    })
    expect(await resolveRole(env, 'price')).toEqual({
      selection: roles.price,
      mode: 'binding',
      available: true,
      revision: 4,
    })
    expect(await resolveRole(env, 'vision')).toEqual({
      selection: roles.vision,
      mode: 'binding',
      available: true,
      revision: 4,
    })
  })

  it('keeps saved selections while local AI_MODE=mock overrides the effective mode', async () => {
    const { db } = settingsDb(2, roles)
    expect(await resolveRole(roleEnv({ MOVERS_DB: db, AI_MODE: 'mock' }), 'price')).toEqual({
      selection: roles.price,
      mode: 'mock',
      available: true,
      revision: 2,
    })
  })

  it('keeps forced offline mock available when the local settings table cannot be read', async () => {
    const prepare = vi.fn(() => {
      throw new Error('no such table: ai_settings')
    })
    const env = roleEnv({ MOVERS_DB: { prepare } as unknown as D1Database, AI_MODE: 'mock' })
    expect(await resolveRole(env, 'price')).toEqual({
      selection: { backend: 'gateway', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
      mode: 'mock',
      available: true,
      revision: 0,
    })
    expect(prepare).toHaveBeenCalledOnce()
  })

  it('marks a selected provider unavailable for a missing binding or placeholder token', async () => {
    const { db } = settingsDb(2, roles)
    expect(await resolveRole(roleEnv({ MOVERS_DB: db }), 'price')).toMatchObject({ mode: 'binding', available: false })
    expect(await resolveRole(roleEnv({ MOVERS_DB: db, CF_AIG_TOKEN: PLACEHOLDER }), 'chat')).toMatchObject({
      mode: 'gateway',
      available: false,
    })
  })

  it('ignores the local settings database in preview and keeps environment model defaults', async () => {
    const { db, prepare } = settingsDb(7, roles)
    expect(
      await resolveRole(roleEnv({ ENV: 'preview', MOVERS_DB: db, CHAT_MODEL: 'preview-chat', AI }), 'chat'),
    ).toEqual({
      selection: { backend: 'gateway', model: 'preview-chat' },
      mode: 'gateway',
      available: true,
      revision: 0,
    })
    expect(await resolveRole(roleEnv({ ENV: 'preview', MOVERS_DB: db, AI, CF_AIG_TOKEN: '' }), 'vision')).toEqual({
      selection: { backend: 'binding', model: '@cf/meta/llama-3.2-11b-vision-instruct' },
      mode: 'binding',
      available: true,
      revision: 0,
    })
    expect(prepare).not.toHaveBeenCalled()
  })
})
