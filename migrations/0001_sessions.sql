CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  findings INTEGER NOT NULL,
  mode TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_at ON sessions (at);
