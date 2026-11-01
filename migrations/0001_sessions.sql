CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  findings INTEGER NOT NULL CHECK (findings >= 0),
  mode TEXT NOT NULL CHECK (mode IN ('absolute', 'percent-only'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_at ON sessions (at);
