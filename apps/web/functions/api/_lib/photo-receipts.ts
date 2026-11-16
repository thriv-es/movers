export interface PhotoRef { url: string; receipt: string | null }
export interface ReceiptRecord { sessionId: string; objectKey: string; expiresAt: string }
export const PHOTO_RECEIPT_DAYS = 30

async function receiptHash(receipt: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(receipt))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function issuePhotoReceipt(db: D1Database, sessionId: string, objectKey: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const receipt = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const issuedAt = new Date()
  const expiresAt = new Date(issuedAt.getTime() + PHOTO_RECEIPT_DAYS * 24 * 60 * 60 * 1000).toISOString()
  await db.prepare('INSERT INTO photo_receipts (receipt_hash, session_id, object_key, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await receiptHash(receipt), sessionId, objectKey, issuedAt.toISOString(), expiresAt).run()
  return receipt
}

export async function verifyPhotoReceipt(db: D1Database, sessionId: string, objectKey: string, receipt: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(receipt)) return false
  const record = await db.prepare('SELECT session_id, object_key, expires_at FROM photo_receipts WHERE receipt_hash = ?')
    .bind(await receiptHash(receipt)).first<{ session_id: string; object_key: string; expires_at: string }>()
  return !!record && record.session_id === sessionId && record.object_key === objectKey && record.expires_at > new Date().toISOString()
}
