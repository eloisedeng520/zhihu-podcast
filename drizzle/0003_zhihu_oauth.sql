CREATE TABLE IF NOT EXISTS zhihu_oauth_pending (
  browser_hash TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS zhihu_oauth_sessions (
  id_hash TEXT PRIMARY KEY,
  encrypted_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
