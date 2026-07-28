CREATE TABLE IF NOT EXISTS notification_subscribers (
  chat_id TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 1,
  subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  content_id TEXT PRIMARY KEY,
  delivered_at TEXT NOT NULL DEFAULT (datetime('now'))
);
