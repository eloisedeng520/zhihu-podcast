CREATE TABLE IF NOT EXISTS zhihu_oauth_session_info (
  id_hash TEXT PRIMARY KEY,
  state_verified INTEGER NOT NULL,
  profile_json TEXT,
  profile_error TEXT,
  updated_at INTEGER NOT NULL
);
