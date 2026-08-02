const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');
const worker = fs.readFileSync('cloudflare/telegram-admin/src/index.js', 'utf8');
const serviceWorker = fs.readFileSync('sw.js', 'utf8');

assert(html.includes('apri e leggi la lettera ✉️'), 'The letter button is not explicit');
assert(html.includes("location.hash==='#sorpreseDaLontano'"), 'The surprise deep-link is not handled');
assert(html.includes('La tua lettera è pronta'), 'The letter availability message is missing');
assert(worker.includes("kind === 'surprise' ? 'sorpreseDaLontano' : 'pensieriDiOggi'"), 'Push notifications do not target the correct section');
assert(worker.includes('siteUrl(env, item.kind)'), 'Unlock notifications do not use the content kind');
assert(serviceWorker.includes("casa-nostra-v52"), 'The app cache was not refreshed');
assert(html.includes("window.addEventListener('pageshow',()=>refreshContent())"), 'Content is not refreshed when the mobile app resumes');
assert(html.includes("document.addEventListener('visibilitychange'"), 'Content is not refreshed when the app returns to the foreground');
assert(html.includes("CONTENT_API}?fresh=${Date.now()}"), 'Telegram content requests are not cache-busted');
assert(html.includes("sw.js?v=52"), 'The latest service worker is not explicitly requested');
assert(serviceWorker.includes('hadOlderVersion'), 'Older installed app versions are not migrated');

for (const source of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) new Function(source[1]);
console.log('Letter deep-link verified.');
