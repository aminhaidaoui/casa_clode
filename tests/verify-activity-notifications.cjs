const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');
const worker = fs.readFileSync('cloudflare/telegram-admin/src/index.js', 'utf8');
const migration = fs.readFileSync('cloudflare/telegram-admin/migrations/0005_activity_notifications.sql', 'utf8');

assert(html.includes('/notify-activity'), 'The site must call the activity endpoint');
assert(html.includes("notifyCasaActivity('enter')"), 'Entry must be reported');
assert(html.includes("'galaxy_open'"), 'Galaxy opens must be reported');
assert(html.includes("'letter_open'"), 'Letter opens must be reported');
assert(html.includes("'video_play'"), 'Video starts must be reported');
assert(html.includes("notifyCasaActivity('mood_select'"), 'Mood choices must be reported');
assert(html.includes("notifyCasaActivity('audio_play'"), 'Audio starts must be reported');
assert(html.includes('Non invia la tua posizione'), 'The privacy note must explain what is not sent');

assert(worker.includes("url.pathname === '/notify-activity'"), 'Worker endpoint is missing');
assert(worker.includes('isPublicSiteRequest'), 'Origin validation is missing');
assert(worker.includes('activity_notification_throttle'), 'Server throttle is missing');
assert(worker.includes("event === 'galaxy_open' && months.has(detail)"), 'Galaxy details must be allow-listed');
assert(worker.includes("event === 'mood_select' && moods.has(detail)"), 'Mood details must be allow-listed');
assert(worker.includes("event === 'audio_play' && audioCategories.has(detail)"), 'Audio categories must be allow-listed');
assert(migration.includes('CREATE TABLE IF NOT EXISTS activity_notification_throttle'), 'Throttle migration is missing');

for (const source of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  new Function(source[1]);
}

console.log('Activity notifications verified.');
