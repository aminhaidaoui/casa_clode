CREATE TABLE IF NOT EXISTS admin_states (
  chat_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
