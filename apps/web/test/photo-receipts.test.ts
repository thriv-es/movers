// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { issuePhotoReceipt, verifyPhotoReceipt } from '../functions/api/_lib/photo-receipts'
import images from '../functions/api/_routes/images'

const sessionA = '11111111-1111-4111-8111-111111111111'
const sessionB = '22222222-2222-4222-8222-222222222222'

function fakeDb() {
  const rows = new Map<string, { receipt_hash: string; session_id: string; object_key: string; expires_at: string }>()
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: string[]) {
          return {
            async run() {
              if (sql.includes('DELETE FROM photo_receipts')) {
                for (const [hash, row] of rows) if (row.expires_at <= values[0]!) rows.delete(hash)
              } else if (sql.includes('INSERT INTO photo_receipts')) {
                rows.set(values[0]!, { receipt_hash: values[0]!, session_id: values[1]!, object_key: values[2]!, expires_at: values[4]! })
              } else throw new Error('Unexpected D1 write')
              return { success: true }
            },
            async first() {
              if (!sql.includes('SELECT')) throw new Error('Unexpected D1 read')
              return rows.get(values[0]!) ?? null
            },
          }
        },
      }
    },
  }
  return { db: db as unknown as D1Database, rows }
}

describe('photo receipts', () => {
  it('stores only a SHA-256 hash and binds a random receipt to its session and object', async () => {
    const { db, rows } = fakeDb()
    const receipt = await issuePhotoReceipt(db, sessionA, 'image-a')
    expect(receipt).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(rows.size).toBe(1)
    const [hash, record] = [...rows.entries()][0]!
    expect(hash).toBe(createHash('sha256').update(receipt).digest('hex'))
    expect(record).not.toHaveProperty('receipt')
    expect(await verifyPhotoReceipt(db, sessionA, 'image-a', receipt)).toBe(true)
    expect(await verifyPhotoReceipt(db, sessionB, 'image-a', receipt)).toBe(false)
    expect(await verifyPhotoReceipt(db, sessionA, 'image-b', receipt)).toBe(false)
    expect(await verifyPhotoReceipt(db, sessionA, 'image-a', 'other')).toBe(false)
  })

  it('rejects expired receipts', async () => {
    const { db, rows } = fakeDb()
    const receipt = await issuePhotoReceipt(db, sessionA, 'image-a')
    rows.values().next().value!.expires_at = new Date(Date.now() - 1_000).toISOString()
    expect(await verifyPhotoReceipt(db, sessionA, 'image-a', receipt)).toBe(false)
  })

  it.each([1, 2])('leaves no R2 objects when receipt insert %i fails', async (failInsert) => {
    const objects = new Map<string, unknown>()
    const bucket = {
      put: vi.fn(async (key: string, body: unknown) => { objects.set(key, body) }),
      delete: vi.fn(async (key: string) => { objects.delete(key) }),
    }
    let inserts = 0
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async run() {
                if (sql.includes('INSERT INTO photo_receipts') && ++inserts === failInsert) {
                  throw new Error('D1 insert unavailable')
                }
                return { success: true }
              },
            }
          },
        }
      },
    }
    const form = new FormData()
    form.set('sessionId', sessionA)
    form.append('images', new File(['first'], 'room-a.jpg', { type: 'image/jpeg' }))
    if (failInsert === 2) form.append('images', new File(['second'], 'room-b.jpg', { type: 'image/jpeg' }))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await images.request('http://localhost/upload', { method: 'POST', body: form }, {
      MOVERS_DB: db, MOVERS_BUCKET: bucket,
    })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to upload images' })
    expect(objects.size).toBe(0)
    expect(errorLog).not.toHaveBeenCalled()
    errorLog.mockRestore()
  })

  it('issues one receipt for a bounded image upload and rejects invalid requests before an R2 write', async () => {
    const { db, rows } = fakeDb()
    const put = vi.fn(async () => ({}))
    const bindings = { MOVERS_DB: db, MOVERS_BUCKET: { put } }
    const upload = async (sessionId: string, file: File, env: object = bindings) => {
      const form = new FormData()
      form.set('sessionId', sessionId)
      form.set('images', file)
      return images.request('http://localhost/upload', { method: 'POST', body: form }, env)
    }
    const res = await upload(sessionA, new File(['picture'], 'room.jpg', { type: 'image/jpeg' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { uploads: { url: string; receipt: string }[] }
    expect(body.uploads).toHaveLength(1)
    expect(body.uploads[0]?.url).toMatch(/^http:\/\/localhost\/api\/images\//)
    expect(await verifyPhotoReceipt(db, sessionA, decodeURIComponent(body.uploads[0]!.url.split('/').pop()!), body.uploads[0]!.receipt)).toBe(true)
    expect(put).toHaveBeenCalledTimes(1)
    expect(rows.size).toBe(1)

    expect((await upload('bad-id', new File(['picture'], 'room.jpg', { type: 'image/jpeg' }))).status).toBe(400)
    expect((await upload(sessionA, new File(['text'], 'room.txt', { type: 'text/plain' }))).status).toBe(400)
    expect((await upload(sessionA, new File(['picture'], 'room.jpg', { type: 'image/jpeg' }), { MOVERS_BUCKET: { put } })).status).toBe(503)
    expect(put).toHaveBeenCalledTimes(1)
  })
})
