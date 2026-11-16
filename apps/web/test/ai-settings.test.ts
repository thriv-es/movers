import { describe, expect, it } from 'vitest'
import { resolveRole } from '../functions/api/_lib/ai-mode'
import type { Bindings } from '../functions/api/_lib/types'
import {
  DEFAULT_ROLES,
  MODEL_CATALOG,
  readAiSettings,
  readSavedAiSettings,
  updateAiSettings,
  validateRoles,
} from '../functions/api/_lib/ai-settings'

const textDefault = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const textAlternative = '@cf/meta/llama-3.1-8b-instruct-fp8-fast'
const visionDefault = '@cf/meta/llama-3.2-11b-vision-instruct'
const initialRoles = {
  chat: { backend: 'gateway', model: textDefault },
  price: { backend: 'gateway', model: textDefault },
  vision: { backend: 'gateway', model: visionDefault },
}

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
            throw new Error(`Unexpected SELECT: ${sql}`)
          return row as T | null
        },
        async run() {
          if (sql === 'INSERT OR IGNORE INTO ai_settings (id, revision, roles_json) VALUES (1, 0, ?)') {
            if (row !== null) return { meta: { changes: 0 } }
            row = { revision: 0, roles_json: params[0] as string }
            return { meta: { changes: 1 } }
          }
          if (sql === 'UPDATE ai_settings SET roles_json = ?, revision = revision + 1 WHERE id = 1 AND revision = ?') {
            const current = row as { revision: number; roles_json: string } | null
            if (current === null || current.revision !== params[1]) return { meta: { changes: 0 } }
            row = { revision: current.revision + 1, roles_json: params[0] as string }
            return { meta: { changes: 1 } }
          }
          throw new Error(`Unexpected write: ${sql}`)
        },
      }
    },
  } as unknown as D1Database
}

describe('AI role catalog', () => {
  it('restricts vision to the existing vision model and documents the text alternative caveat', () => {
    expect(MODEL_CATALOG.vision.map((entry) => entry.model)).toEqual([visionDefault])
    expect(MODEL_CATALOG.chat.map((entry) => entry.model)).toEqual([textDefault, textAlternative])
    expect(MODEL_CATALOG.price.map((entry) => entry.model)).toEqual([textDefault, textAlternative])
    expect(MODEL_CATALOG.chat[1]?.caveat).toMatch(/session-block prompt.*hallucinated/i)
  })

  it('rejects text models for vision, unknown backends and arbitrary model IDs', () => {
    expect(() => validateRoles({ ...initialRoles, vision: { backend: 'gateway', model: textDefault } })).toThrow()
    expect(() => validateRoles({ ...initialRoles, price: { backend: 'other', model: textDefault } })).toThrow()
    expect(() => validateRoles({ ...initialRoles, chat: { backend: 'gateway', model: '@cf/unknown' } })).toThrow()
  })

  it('requires exactly chat, price and vision, and accepts catalog models on either backend', () => {
    expect(() => validateRoles({ ...initialRoles, extra: initialRoles.chat })).toThrow()
    expect(() => validateRoles({ chat: initialRoles.chat, price: initialRoles.price })).toThrow()
    expect(
      validateRoles({
        chat: { backend: 'binding', model: textAlternative },
        price: { backend: 'gateway', model: textDefault },
        vision: { backend: 'binding', model: visionDefault },
      }),
    ).toEqual({
      chat: { backend: 'binding', model: textAlternative },
      price: { backend: 'gateway', model: textDefault },
      vision: { backend: 'binding', model: visionDefault },
    })
  })
})

describe('revisioned AI settings', () => {
  it('returns the existing model defaults at revision 0 when no row exists', async () => {
    expect(DEFAULT_ROLES).toEqual(initialRoles)
    expect(await readAiSettings(fakeDb())).toEqual({ revision: 0, roles: initialRoles })
    expect(await readSavedAiSettings(fakeDb())).toBeNull()
  })

  it('rejects a stale first write without changing legacy binding or mock, then accepts revision 0', async () => {
    const db = fakeDb()
    const selected = { ...initialRoles, price: { backend: 'binding', model: textAlternative } }
    expect(await updateAiSettings(db, 1, selected)).toBeNull()
    expect(await readSavedAiSettings(db)).toBeNull()
    const binding = {
      ENV: 'development',
      MOVERS_DB: db,
      AI: { run: async () => ({ response: '' }) },
      PRICE_MODEL: 'legacy-price',
    } as unknown as Bindings
    expect(await resolveRole(binding, 'price')).toMatchObject({
      selection: { backend: 'binding', model: 'legacy-price' },
      mode: 'binding',
      available: true,
      revision: 0,
    })
    expect(await resolveRole({ ENV: 'development', MOVERS_DB: db } as Bindings, 'price')).toMatchObject({
      mode: 'mock',
      available: true,
      revision: 0,
    })
    expect(await updateAiSettings(db, 0, selected)).toEqual({ revision: 1, roles: selected })
    expect(await resolveRole(binding, 'price')).toMatchObject({
      selection: selected.price,
      mode: 'binding',
      revision: 1,
    })
  })

  it('does not treat an existing revision-0 bootstrap row as a saved selection', async () => {
    const db = fakeDb()
    await db
      .prepare('INSERT OR IGNORE INTO ai_settings (id, revision, roles_json) VALUES (1, 0, ?)')
      .bind(JSON.stringify(initialRoles))
      .run()
    expect(await readAiSettings(db)).toEqual({ revision: 0, roles: initialRoles })
    expect(await readSavedAiSettings(db)).toBeNull()
    expect(
      await resolveRole(
        {
          ENV: 'development',
          MOVERS_DB: db,
          AI_MODE: 'binding',
          AI: { run: async () => ({ response: '' }) },
        } as unknown as Bindings,
        'price',
      ),
    ).toMatchObject({ mode: 'binding', available: true })
    const selected = { ...initialRoles, price: { backend: 'binding', model: textAlternative } }
    expect(await updateAiSettings(db, 0, selected)).toEqual({ revision: 1, roles: selected })
  })

  it('accepts only one of two writes with the same expected revision', async () => {
    const db = fakeDb()
    const selected = { ...initialRoles, price: { backend: 'binding', model: textAlternative } }
    expect(await updateAiSettings(db, 0, selected)).toEqual({ revision: 1, roles: selected })
    expect(await updateAiSettings(db, 0, initialRoles)).toBeNull()
    expect(await readAiSettings(db)).toEqual({ revision: 1, roles: selected })
  })

  it('rejects invalid roles before writing and rejects invalid persisted roles on read', async () => {
    const db = fakeDb()
    await expect(updateAiSettings(db, 0, { ...initialRoles, vision: initialRoles.chat })).rejects.toThrow()
    expect(await readAiSettings(db)).toEqual({ revision: 0, roles: initialRoles })

    await db
      .prepare('INSERT OR IGNORE INTO ai_settings (id, revision, roles_json) VALUES (1, 0, ?)')
      .bind(JSON.stringify({ ...initialRoles, vision: initialRoles.chat }))
      .run()
    await expect(readAiSettings(db)).rejects.toThrow()
  })
})
