const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const serviceWorker = read('sw.js');
const worker = read('cloudflare/telegram-admin/src/index.js');
const wrangler = read('cloudflare/telegram-admin/wrangler.jsonc');
const manifest = JSON.parse(read('manifest.webmanifest'));
const migration = read('cloudflare/telegram-admin/migrations/0004_web_push_subscriptions.sql');
let failures = 0;

function check(condition, label) {
  if (condition) console.log(`OK  ${label}`);
  else {
    failures += 1;
    console.error(`ERR ${label}`);
  }
}

check(index.includes('id="pushNotificationButton"'), 'pulsante notifiche presente');
check(index.includes('Notification.requestPermission()'), 'permesso richiesto dopo il tocco');
check(index.includes('registration.pushManager.subscribe'), 'iscrizione Push API presente');
check(index.includes('Aggiungi alla schermata Home'), 'istruzioni iPhone presenti');
check(serviceWorker.includes("addEventListener('push'"), 'ricezione push nel service worker');
check(serviceWorker.includes("addEventListener('notificationclick'"), 'apertura sito dalla notifica');
check(worker.includes("'/push/subscribe'"), 'endpoint iscrizione presente');
check(worker.includes("'/push/unsubscribe'"), 'endpoint disiscrizione presente');
check(worker.includes('webpush.sendNotification'), 'invio Web Push presente');
check(worker.includes('statusCode === 404 || statusCode === 410'), 'iscrizioni scadute rimosse');
check(migration.includes('web_push_subscriptions'), 'tabella iscrizioni presente');
check(wrangler.includes('"nodejs_compat"'), 'compatibilità Web Push Cloudflare attiva');
check(wrangler.includes('"* * * * *"'), 'controllo sblocchi ogni minuto');
check(manifest.display === 'standalone' && manifest.id === './', 'web app installabile su iPhone');
check(!wrangler.includes('"VAPID_PRIVATE_KEY"'), 'chiave privata assente dal repository');

process.exitCode = failures ? 1 : 0;
