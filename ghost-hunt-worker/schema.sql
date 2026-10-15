-- Ghost Hunt D1 schema. Safe to run more than once.

-- One row per golden ghost: 'live' is the real prize, 'test' is used by debug mode.
CREATE TABLE IF NOT EXISTS golden (
  id TEXT PRIMARY KEY,
  claimed_at TEXT,
  data TEXT,
  ip TEXT,
  ua TEXT
);
INSERT OR IGNORE INTO golden (id) VALUES ('live'), ('test');

-- Seeded layout per shuffle period, stored so it stays stable for the whole period.
CREATE TABLE IF NOT EXISTS layouts (
  period INTEGER PRIMARY KEY,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Code verification attempts, for rate limiting.
CREATE TABLE IF NOT EXISTS attempts (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_ip_ts ON attempts (ip, ts);

-- Simple counters for campaign stats (catch:1..5, verify:ok, verify:fail).
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
