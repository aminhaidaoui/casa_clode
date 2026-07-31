const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');

assert(html.includes('id="ritornoDalMarocco"'), 'Return section is missing');
assert(html.includes('Date.UTC(2026,7,25,16,45,0)'), 'Italian summer-time target must be 2026-08-25 16:45 UTC');
assert.strictEqual(new Date(Date.UTC(2026, 7, 25, 16, 45, 0)).toISOString(), '2026-08-25T16:45:00.000Z');
assert(html.includes('25 agosto 2026 · 18:45 · ora italiana'), 'Visible Italian date is missing');
assert(html.includes('ogni chilometro smetterà di separarci'), 'Return phrase is missing');
assert(html.includes("setInterval(updateReturnCountdown,1000)"), 'Live countdown update is missing');

for (const source of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  new Function(source[1]);
}

console.log('Return countdown verified.');
