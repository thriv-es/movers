// @vitest-environment node
import { describe, expect, it } from 'vitest'
import admin from '../functions/api/_routes/admin'

const textModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const visionModel = '@cf/meta/llama-3.2-11b-vision-instruct'
const roles = {
  chat: { backend: 'gateway', model: textModel },
  price: { backend: 'gateway', model: textModel },
  vision: { backend: 'gateway', model: visionModel },
}
const env = (overrides: Record<string, unknown> = {}) => ({ ENV: 'development', CF_AIG_TOKEN: '', ...overrides })
const patch = (body: unknown) => ({
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

function fakeDb() {
  let row: { revision: number; roles_json: string } | null = null
  return {
    prepare(sql: string) {
      let params: unknown[] = []
      return {
        bind(...values: unknown[]) {
          params = values
          return this
        },
        async first<T>() {
          if (sql !== 'SELECT revision, roles_json FROM ai_settings WHERE id = 1')
            throw Error(`Unexpected read: ${sql}`)
          return row as T | null
        },
        async run() {
          if (sql === 'INSERT OR IGNORE INTO ai_settings (id, revision, roles_json) VALUES (1, 0, ?)') {
            if (!row) row = { revision: 0, roles_json: params[0] as string }
            return { meta: { changes: 1 } }
          }
          if (sql === 'UPDATE ai_settings SET roles_json = ?, revision = revision + 1 WHERE id = 1 AND revision = ?') {
            if (!row || row.revision !== params[1]) return { meta: { changes: 0 } }
            row = { revision: row.revision + 1, roles_json: params[0] as string }
            return { meta: { changes: 1 } }
          }
          throw Error(`Unexpected write: ${sql}`)
        },
      }
    },
  } as unknown as D1Database
}

describe('local-only admin AI settings', () => {
  it.each(['preview', 'production', undefined])('returns 404 for GET and PATCH with ENV=%s', async (ENV) => {
    for (const init of [{}, patch({ expectedRevision: 0, roles })]) {
      const response = await admin.request('http://127.0.0.1/ai-settings', init, env({ ENV, MOVERS_DB: fakeDb() }))
      expect(response.status).toBe(404)
    }
  })

  it.each(['example.com', '127.0.0.2', 'localhost.evil.test'])('returns 404 for non-loopback host %s', async (host) => {
    for (const init of [{}, patch({ expectedRevision: 0, roles })]) {
      expect((await admin.request(`http://${host}/ai-settings`, init, env({ MOVERS_DB: fakeDb() }))).status).toBe(404)
    }
  })

  it('requires D1 without falling back to in-memory settings', async () => {
    for (const init of [{}, patch({ expectedRevision: 0, roles })]) {
      expect((await admin.request('http://localhost/ai-settings', init, env())).status).toBe(503)
    }
    expect((await admin.request('http://localhost/ai-settings', {}, env({ MOVERS_DB: fakeDb() }))).status).toBe(200)
  })

  it('returns defaults and effective modes, without token or binding details', async () => {
    const response = await admin.request(
      'http://127.0.0.1/ai-settings',
      {},
      env({ MOVERS_DB: fakeDb(), CF_AIG_TOKEN: 'private-value', AI_MODE: 'mock' }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      settings: { revision: 0, roles },
      effective: {
        chat: { mode: 'mock', available: true },
        price: { mode: 'mock', available: true },
        vision: { mode: 'mock', available: true },
      },
      catalog: { vision: [{ model: visionModel }] },
    })
    expect(body.catalog.chat[0].model).toBe(textModel)
    expect(JSON.stringify(body)).not.toContain('private-value')
  })

  it('rejects incompatible role/model and malformed revision before persisting', async () => {
    const db = fakeDb()
    for (const body of [
      { expectedRevision: 0, roles: { ...roles, vision: roles.chat } },
      { expectedRevision: -1, roles },
      { expectedRevision: '0', roles },
    ]) {
      expect((await admin.request('http://localhost/ai-settings', patch(body), env({ MOVERS_DB: db }))).status).toBe(
        400,
      )
    }
    const current = await (await admin.request('http://localhost/ai-settings', {}, env({ MOVERS_DB: db }))).json()
    expect(current.settings.revision).toBe(0)
  })

  it('keeps legacy auto binding after a stale first PATCH and accepts the next revision-0 PATCH', async () => {
    const db = fakeDb()
    const local = env({ MOVERS_DB: db, AI: { run: async () => ({ response: '' }) } })
    const changed = { ...roles, price: { backend: 'binding', model: textModel } }
    const stale = await admin.request(
      'http://localhost/ai-settings',
      patch({ expectedRevision: 1, roles: changed }),
      local,
    )
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'Settings changed; reload and retry.' })
    const current = await admin.request('http://localhost/ai-settings', {}, local)
    expect(await current.json()).toMatchObject({
      settings: { revision: 0, roles },
      effective: { chat: { mode: 'binding', available: true }, price: { mode: 'binding', available: true } },
    })
    const saved = await admin.request(
      'http://localhost/ai-settings',
      patch({ expectedRevision: 0, roles: changed }),
      local,
    )
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ settings: { revision: 1, roles: changed } })
  })

  it('increments revision on save and returns 409 for a stale writer', async () => {
    const db = fakeDb()
    const changed = { ...roles, price: { backend: 'binding', model: textModel } }
    const saved = await admin.request(
      'http://localhost/ai-settings',
      patch({ expectedRevision: 0, roles: changed }),
      env({ MOVERS_DB: db }),
    )
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({
      settings: { revision: 1, roles: changed },
      effective: { price: { mode: 'binding', available: false } },
    })
    const stale = await admin.request(
      'http://localhost/ai-settings',
      patch({ expectedRevision: 0, roles }),
      env({ MOVERS_DB: db }),
    )
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'Settings changed; reload and retry.' })
  })
})
