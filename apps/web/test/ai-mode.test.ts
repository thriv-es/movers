import { describe, expect, it } from 'vitest'
import { resolveAiMode } from '../functions/api/_lib/ai-mode'

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
