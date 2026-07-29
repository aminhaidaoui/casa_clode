CREATE TABLE IF NOT EXISTS activity_notification_throttle (
  throttle_key TEXT PRIMARY KEY,
  last_sent_at INTEGER NOT NULL
);
