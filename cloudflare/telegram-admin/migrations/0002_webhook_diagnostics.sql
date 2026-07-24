CREATE TABLE IF NOT EXISTS webhook_diagnostics (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  command TEXT NOT NULL,
  authorized INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
