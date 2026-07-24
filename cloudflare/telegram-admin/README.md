# Casa Nostra · pannello Telegram

Worker privato per programmare contenuti dal telefono.

## Segreti richiesti

Non inserirli mai nel repository:

- `TELEGRAM_BOT_TOKEN`
- `ADMIN_CHAT_ID`
- `TELEGRAM_WEBHOOK_SECRET`

Vanno salvati con `wrangler secret put`.

## Risorsa richiesta

- bucket R2 `casa-nostra-media`, collegato al binding `MEDIA`

## Flusso di distribuzione

1. `npx wrangler login`
2. `npx wrangler r2 bucket create casa-nostra-media`
3. impostare i tre segreti
4. `npx wrangler deploy`
5. registrare il webhook Telegram su `/telegram/webhook` includendo il secret token

Il Worker conserva manifest, bozze e allegati nel bucket. Soltanto `ADMIN_CHAT_ID`
può aprire il pannello; gli altri aggiornamenti Telegram vengono ignorati.
