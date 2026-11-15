-- Saved estimates (leads), signed-up movers and quote requests.
-- JSON columns hold the same shapes the API validates with zod (src/data/z-common/z-move-demo.ts).

CREATE TABLE IF NOT EXISTS estimates (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'own',
  status TEXT NOT NULL DEFAULT 'new',
  move_details TEXT NOT NULL,
  analysis TEXT NOT NULL,
  items TEXT NOT NULL,
  price TEXT NOT NULL,
  photo_keys TEXT NOT NULL DEFAULT '[]',
  contact TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS estimates_created_at ON estimates (created_at DESC);

CREATE TABLE IF NOT EXISTS movers (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  service_area TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quote_requests (
  id TEXT PRIMARY KEY,
  estimate_id TEXT NOT NULL REFERENCES estimates (id),
  mover_id TEXT NOT NULL REFERENCES movers (id),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'logged',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS quote_requests_estimate ON quote_requests (estimate_id);
