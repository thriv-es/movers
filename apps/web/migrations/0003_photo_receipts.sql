CREATE TABLE IF NOT EXISTS photo_receipts (
  receipt_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS photo_receipts_expiry ON photo_receipts (expires_at);
