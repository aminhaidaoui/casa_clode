# Casa Nostra · pannello Telegram

Worker privato per programmare contenuti dal telefono.

## Segreti richiesti

Non inserirli mai nel repository:

- `TELEGRAM_BOT_TOKEN`
- `ADMIN_CHAT_ID`
- `TELEGRAM_WEBHOOK_SECRET`

Vanno salvati con `wrangler secret put`.

## Risorsa utilizzata

- namespace KV collegato al binding `MEDIA`
- database D1 collegato al binding `DB` per lo stato immediato della conversazione

## Flusso di distribuzione

1. `npx wrangler login`
2. creare il namespace KV `MEDIA` e inserirne l'id in `wrangler.jsonc`
3. creare il database D1 e applicare le migrazioni
4. impostare i segreti
5. `npx wrangler deploy`
6. registrare il webhook Telegram su `/telegram/webhook` includendo il secret token

Il Worker conserva manifest, bozze e allegati nel namespace KV. Soltanto `ADMIN_CHAT_ID`
può aprire il pannello; gli altri aggiornamenti Telegram vengono ignorati.

## Notifiche sul telefono

Il Worker controlla ogni minuto il calendario e invia una notifica Telegram quando
si sblocca un buongiorno, una buonanotte o una sorpresa. Invia inoltre un avviso
quando dal pannello viene programmato un nuovo contenuto.

Per attivarle sul proprio telefono:

1. aprire il bot Telegram e premere **Avvia**;
2. premere **Attiva notifiche**, oppure inviare `/notifiche`;
3. per disattivarle, usare `/stopnotifiche`.

Gli iscritti alle notifiche non possono accedere al pannello di amministrazione.
Prima del deploy applicare anche la migrazione D1 `0003_phone_notifications.sql`.
