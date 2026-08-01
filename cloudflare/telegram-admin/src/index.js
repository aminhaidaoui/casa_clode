import webpush from 'web-push';

const MANIFEST_KEY = 'content/manifest.json';
const DEFAULT_MANIFEST = {
  timezone: 'Europe/Rome',
  morningTime: '07:00',
  nightTime: '23:30',
  messages: [],
  surprises: []
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env);
    if (url.pathname === '/health') return json({ ok: true, service: 'casa-nostra-telegram' });
    if (url.pathname === '/content' && request.method === 'GET') {
      return cors(json(await readManifest(env)), env);
    }
    if (url.pathname === '/push/vapid-public-key' && request.method === 'GET') {
      return cors(json({ publicKey: String(env.VAPID_PUBLIC_KEY || '') }), env);
    }
    if (url.pathname === '/push/subscribe' && request.method === 'POST') {
      return cors(await subscribeWebPush(request, env), env);
    }
    if (url.pathname === '/push/unsubscribe' && request.method === 'POST') {
      return cors(await unsubscribeWebPush(request, env), env);
    }
    if (url.pathname.startsWith('/media/') && request.method === 'GET') {
      return serveMedia(url.pathname.slice('/media/'.length), env);
    }
    if ((url.pathname === '/notify-activity' || url.pathname === '/notify-entry') && request.method === 'POST') {
      if (!isPublicSiteRequest(request, env)) {
        return cors(json({ ok: false, error: 'Origin not allowed' }, { status: 403 }), env);
      }
      const payload = url.pathname === '/notify-entry'
        ? { event: 'enter' }
        : await request.json().catch(() => ({}));
      return cors(await notifyActivity(payload, env, ctx), env);
    }
    if (url.pathname === '/admin/setup-webhook' && request.method === 'POST') {
      if (!safeEqual(request.headers.get('X-Casa-Setup'), env.SETUP_SECRET)) {
        return new Response('Forbidden', { status: 403 });
      }
      const result = await telegram(env, 'setWebhook', {
        url: `${env.PUBLIC_BASE_URL}/telegram/webhook`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false
      });
      return json(result, { status: result.ok ? 200 : 502 });
    }
    if (url.pathname === '/admin/telegram-status' && request.method === 'POST') {
      if (!safeEqual(request.headers.get('X-Casa-Setup'), env.SETUP_SECRET)) {
        return new Response('Forbidden', { status: 403 });
      }
      const diagnosticAction = url.searchParams.get('action');
      const [identity, webhook, menu] = await Promise.all([
        telegram(env, 'getMe', {}),
        telegram(env, 'getWebhookInfo', {}),
        diagnosticAction === 'calendar'
          ? showCalendar(adminChatId(env), env)
          : showMenu(adminChatId(env), env, 'Pannello collegato correttamente.'),
      ]);
      const lastUpdate = await env.DB.prepare('SELECT kind, command, authorized, received_at FROM webhook_diagnostics WHERE id = 1').first();
      return json({
        bot: { ok: identity.ok, username: identity.result?.username || null },
        webhook: {
          ok: webhook.ok,
          url: webhook.result?.url || null,
          pending: webhook.result?.pending_update_count || 0,
          lastError: webhook.result?.last_error_message || null
        },
        menu: { ok: menu.ok, description: menu.description || null },
        lastUpdate: lastUpdate || null
      });
    }
    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (!safeEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response('Forbidden', { status: 403 });
      }
      const update = await request.json();
      ctx.waitUntil(handleUpdate(update, env).catch(async error => {
        console.error('Telegram update failed', error);
        await sendTelegram(env, '⚠️ Il pannello ha incontrato un piccolo errore. Riprova con /menu.');
      }));
      return json({ ok: true });
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(notifyUnlockedContent(env, controller.scheduledTime || Date.now()));
  }
};

async function handleUpdate(update, env) {
  const message = update.message;
  const callback = update.callback_query;
  const chatId = String(message?.chat?.id || callback?.message?.chat?.id || '');
  const command = String(message?.text || callback?.data || '').slice(0, 80);
  const text = (message?.text || '').trim();
  const authorized = Boolean(chatId && safeEqual(chatId, adminChatId(env)));
  try {
    await env.DB.prepare(`INSERT INTO webhook_diagnostics (id, chat_id, kind, command, authorized, received_at)
      VALUES (1, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET chat_id = excluded.chat_id, kind = excluded.kind,
      command = excluded.command, authorized = excluded.authorized, received_at = excluded.received_at`)
      .bind(chatId, callback ? 'callback' : 'message', command, authorized ? 1 : 0).run();
  } catch (error) {
    console.error('Unable to record Telegram diagnostic', error);
  }

  if (callback && callback.data === 'notify:on') {
    await telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id });
    return subscribeNotifications(chatId, env);
  }
  if (callback && callback.data === 'notify:off') {
    await telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id });
    return unsubscribeNotifications(chatId, env);
  }
  if (callback && callback.data === 'notify:menu') {
    await telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id });
    return showNotificationMenu(chatId, env);
  }
  if (text === '/notifiche') return subscribeNotifications(chatId, env);
  if (text === '/stopnotifiche') return unsubscribeNotifications(chatId, env);

  if (!authorized) {
    if (command === '/start' || command === '/menu') {
      return showNotificationMenu(chatId, env);
    }
    return;
  }

  if (callback) {
    await telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id });
    return handleCallback(chatId, callback.data || '', env);
  }

  if (text === '/start' || text === '/menu') return showMenu(chatId, env);
  if (text === '/annulla') {
    await clearState(chatId, env);
    await send(chatId, 'Operazione annullata. Nessun contenuto è stato modificato.', env);
    return showMenu(chatId, env);
  }
  if (text === '/calendario') return showCalendar(chatId, env);

  const state = await readState(chatId, env);
  if (!state) return showMenu(chatId, env);
  return continueWizard(chatId, message, state, env);
}

async function handleCallback(chatId, data, env) {
  if (data === 'menu') return showMenu(chatId, env);
  if (data === 'calendar') return showCalendar(chatId, env);
  if (data.startsWith('new:')) {
    const kind = data.slice(4);
    if (!['morning', 'night', 'surprise'].includes(kind)) return;
    await writeState(chatId, { step: 'date', draft: { kind } }, env);
    return send(chatId, `📅 Scrivi la data in formato AAAA-MM-GG.\nEsempio: 2026-08-03\n\n/annulla per uscire.`, env);
  }
  if (data === 'draft:publish') return publishDraft(chatId, env);
  if (data === 'draft:cancel') {
    await clearState(chatId, env);
    return showMenu(chatId, env, 'Bozza eliminata.');
  }
  if (data.startsWith('delete:')) {
    const id = data.slice(7);
    return askDelete(chatId, id, env);
  }
  if (data.startsWith('confirm-delete:')) {
    const id = data.slice(15);
    return deleteContent(chatId, id, env);
  }
}

async function continueWizard(chatId, message, state, env) {
  const text = (message.text || message.caption || '').trim();
  const draft = state.draft;

  if (state.step === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T12:00:00Z`))) {
      return send(chatId, 'Questa data non è valida. Scrivila così: 2026-08-03', env);
    }
    draft.date = text;
    await writeState(chatId, { step: 'time', draft }, env);
    return send(chatId, `⏰ A che ora italiana deve aprirsi?\nScrivi HH:MM, per esempio ${draft.kind === 'night' ? '23:30' : '07:00'}.`, env);
  }
  if (state.step === 'time') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return send(chatId, 'Ora non valida. Usa il formato HH:MM, per esempio 07:00.', env);
    draft.time = text;
    await writeState(chatId, { step: 'title', draft }, env);
    return send(chatId, '✍️ Scrivi il titolo che vedrà Camilla.', env);
  }
  if (state.step === 'title') {
    if (!text || text.length > 120) return send(chatId, 'Inserisci un titolo tra 1 e 120 caratteri.', env);
    draft.title = text;
    await writeState(chatId, { step: 'note', draft }, env);
    return send(chatId, '💌 Scrivi la breve introduzione che apparirà prima della foto o del video. Puoi anche scrivere /salta.', env);
  }
  if (state.step === 'note') {
    draft.note = text === '/salta' ? '' : text.slice(0, 4000);
    await writeState(chatId, { step: 'letter', draft }, env);
    return send(chatId, '✉️ Ora incolla la lettera completa. Sul sito apparirà in un foglio separato e scorrevole.\nSe non vuoi aggiungere una lettera, scrivi /salta.', env);
  }
  if (state.step === 'letter') {
    draft.letter = text === '/salta' ? '' : text.slice(0, 8000);
    await writeState(chatId, { step: 'media', draft }, env);
    return send(chatId, '🎬 Invia ora il video o la foto.\nPer una sorpresa composta soltanto da testo puoi scrivere /salta.', env);
  }
  if (state.step === 'media') {
    if (text === '/salta' && draft.kind === 'surprise') {
      draft.media = null;
      await writeState(chatId, { step: 'preview', draft }, env);
      return showPreview(chatId, draft, env);
    }
    const file = pickTelegramFile(message);
    if (!file) return send(chatId, 'Invia un video, una foto oppure un documento video. Il limite del bot è 20 MB.', env);
    if (file.size && file.size > 20 * 1024 * 1024) {
      return send(chatId, 'Questo file supera 20 MB. Comprimilo dal telefono oppure usa il caricamento grande che aggiungeremo nella seconda fase.', env);
    }
    const stored = await storeTelegramFile(file, draft, env);
    draft.media = stored;
    await writeState(chatId, { step: 'preview', draft }, env);
    return showPreview(chatId, draft, env);
  }
}

function pickTelegramFile(message) {
  if (message.video) return { id: message.video.file_id, size: message.video.file_size, mime: message.video.mime_type || 'video/mp4', type: 'video' };
  if (message.document) return { id: message.document.file_id, size: message.document.file_size, mime: message.document.mime_type || 'application/octet-stream', name: message.document.file_name, type: message.document.mime_type?.startsWith('image/') ? 'image' : 'video' };
  const photo = message.photo?.[message.photo.length - 1];
  if (photo) return { id: photo.file_id, size: photo.file_size, mime: 'image/jpeg', type: 'image' };
  return null;
}

async function storeTelegramFile(file, draft, env) {
  const info = await telegram(env, 'getFile', { file_id: file.id });
  if (!info.ok) throw new Error('Telegram getFile failed');
  const source = await fetch(`https://api.telegram.org/file/bot${botToken(env)}/${info.result.file_path}`);
  if (!source.ok) throw new Error('Telegram file download failed');
  const extension = extensionFor(file.mime, file.name);
  const id = `${draft.date}-${draft.kind}-${crypto.randomUUID().slice(0, 8)}`;
  const key = `uploads/${id}.${extension}`;
  await env.MEDIA.put(key, source.body, { metadata: { contentType: file.mime } });
  return { key, type: file.type, mime: file.mime, url: `${env.PUBLIC_BASE_URL}/media/${encodeURIComponent(key)}` };
}

async function showPreview(chatId, draft, env) {
  const labels = { morning: '☀️ Buongiorno', night: '🌙 Buonanotte', surprise: '✨ Sorpresa' };
  const media = draft.media ? `\nAllegato: ${draft.media.type}` : '\nSenza allegato';
  const letter = draft.letter ? `\nLettera: presente (${draft.letter.length} caratteri)` : '\nSenza lettera';
  return send(chatId, `${labels[draft.kind]}\n📅 ${draft.date} alle ${draft.time} (ora italiana)\n\n${draft.title}\n${draft.note || ''}${letter}${media}\n\nVuoi programmarlo?`, env, {
    inline_keyboard: [[
      { text: '✅ Programma', callback_data: 'draft:publish' },
      { text: '❌ Annulla', callback_data: 'draft:cancel' }
    ]]
  });
}

async function publishDraft(chatId, env) {
  const state = await readState(chatId, env);
  if (!state?.draft || state.step !== 'preview') return showMenu(chatId, env, 'La bozza non è più disponibile.');
  const draft = state.draft;
  const manifest = await readManifest(env);
  const id = `${draft.date}-${draft.kind}-${crypto.randomUUID().slice(0, 6)}`;
  const item = { id, date: draft.date, time: draft.time, kind: draft.kind, title: draft.title, note: draft.note };
  if (draft.letter) item.letter = draft.letter;
  if (draft.media) {
    if (draft.media.type === 'video') item.video = draft.media.url;
    else item.image = draft.media.url;
  }
  const collection = draft.kind === 'surprise' ? manifest.surprises : manifest.messages;
  collection.push(item);
  collection.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  await writeManifest(manifest, env);
  await clearState(chatId, env);
  await Promise.all([
    notifySubscribers(env, `💌 C'è un nuovo aggiornamento a Casa Nostra.\nUn pensiero è stato preparato per ${draft.date} alle ${draft.time}.\n\n${siteUrl(env, draft.kind)}`),
    notifyWebPush(env, {
      title: 'Casa Nostra si è aggiornata 💌',
      body: 'C’è un nuovo pensiero che ti aspetterà al momento giusto.',
      tag: `update-${id}`,
      url: siteUrl(env, draft.kind)
    })
  ]);
  await send(chatId, `✅ Programmato!\n${draft.date} alle ${draft.time} · ${draft.title}`, env);
  return showMenu(chatId, env);
}

async function showCalendar(chatId, env) {
  const manifest = await readManifest(env);
  const timeFor = item => item.time || (item.kind === 'night' ? manifest.nightTime : item.kind === 'morning' ? manifest.morningTime : '00:00');
  const all = [...manifest.messages, ...manifest.surprises].sort((a, b) => `${a.date}T${timeFor(a)}`.localeCompare(`${b.date}T${timeFor(b)}`));
  if (!all.length) return showMenu(chatId, env, 'Il calendario è vuoto.');
  const icons = { morning: '☀️', night: '🌙', surprise: '✨' };
  const lines = all.slice(0, 30).map(item => `${icons[item.kind]} ${item.date} ${timeFor(item)} · ${item.title}`);
  const keyboard = all.slice(0, 20).map(item => [{ text: `🗑 ${item.date} · ${item.title.slice(0, 24)}`, callback_data: `delete:${item.id}` }]);
  keyboard.push([{ text: '← Menu', callback_data: 'menu' }]);
  return send(chatId, `📅 Calendario Casa Nostra\n\n${lines.join('\n')}`, env, { inline_keyboard: keyboard });
}

async function askDelete(chatId, id, env) {
  const item = await findContent(id, env);
  if (!item) return showCalendar(chatId, env);
  return send(chatId, `Eliminare “${item.title}” del ${item.date}?`, env, {
    inline_keyboard: [[
      { text: 'Sì, elimina', callback_data: `confirm-delete:${id}` },
      { text: 'No', callback_data: 'calendar' }
    ]]
  });
}

async function deleteContent(chatId, id, env) {
  const manifest = await readManifest(env);
  let removed;
  for (const key of ['messages', 'surprises']) {
    const index = manifest[key].findIndex(item => item.id === id);
    if (index >= 0) removed = manifest[key].splice(index, 1)[0];
  }
  if (removed?.video?.includes('/media/')) await env.MEDIA.delete(decodeURIComponent(new URL(removed.video).pathname.slice('/media/'.length)));
  if (removed?.image?.includes('/media/')) await env.MEDIA.delete(decodeURIComponent(new URL(removed.image).pathname.slice('/media/'.length)));
  await writeManifest(manifest, env);
  await send(chatId, removed ? `🗑 “${removed.title}” è stato eliminato.` : 'Contenuto non trovato.', env);
  return showCalendar(chatId, env);
}

async function findContent(id, env) {
  const manifest = await readManifest(env);
  return [...manifest.messages, ...manifest.surprises].find(item => item.id === id);
}

async function showMenu(chatId, env, prefix = '') {
  return send(chatId, `${prefix ? `${prefix}\n\n` : ''}🏠 Pannello Casa Nostra\nCosa vuoi preparare dal telefono?`, env, {
    inline_keyboard: [
      [{ text: '☀️ Buongiorno', callback_data: 'new:morning' }, { text: '🌙 Buonanotte', callback_data: 'new:night' }],
      [{ text: '✨ Sorpresa', callback_data: 'new:surprise' }],
      [{ text: '📅 Calendario', callback_data: 'calendar' }],
      [{ text: '🔔 Notifiche sul telefono', callback_data: 'notify:menu' }]
    ]
  });
}

async function subscribeWebPush(request, env) {
  if (!isAllowedSiteRequest(request, env)) return json({ ok: false, error: 'Forbidden' }, { status: 403 });
  let subscription;
  try {
    subscription = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!isValidPushSubscription(subscription)) {
    return json({ ok: false, error: 'Invalid subscription' }, { status: 400 });
  }
  const endpointHash = await sha256(subscription.endpoint);
  await env.DB.prepare(`INSERT INTO web_push_subscriptions
    (endpoint_hash, endpoint, p256dh, auth, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(endpoint_hash) DO UPDATE SET endpoint = excluded.endpoint,
    p256dh = excluded.p256dh, auth = excluded.auth, updated_at = datetime('now')`)
    .bind(endpointHash, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth).run();
  return json({ ok: true });
}

async function unsubscribeWebPush(request, env) {
  if (!isAllowedSiteRequest(request, env)) return json({ ok: false, error: 'Forbidden' }, { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body?.endpoint !== 'string' || body.endpoint.length > 2048) {
    return json({ ok: false, error: 'Invalid endpoint' }, { status: 400 });
  }
  await env.DB.prepare('DELETE FROM web_push_subscriptions WHERE endpoint_hash = ?')
    .bind(await sha256(body.endpoint)).run();
  return json({ ok: true });
}

function isAllowedSiteRequest(request, env) {
  const origin = request.headers.get('Origin');
  return Boolean(origin && origin === String(env.PUBLIC_SITE_ORIGIN || ''));
}

function isValidPushSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object') return false;
  if (typeof subscription.endpoint !== 'string' || subscription.endpoint.length > 2048) return false;
  if (typeof subscription.keys?.p256dh !== 'string' || subscription.keys.p256dh.length > 256) return false;
  if (typeof subscription.keys?.auth !== 'string' || subscription.keys.auth.length > 128) return false;
  try {
    const endpoint = new URL(subscription.endpoint);
    if (endpoint.protocol !== 'https:') return false;
    if (endpoint.hostname === 'localhost' || endpoint.hostname.endsWith('.local')) return false;
  } catch {
    return false;
  }
  return /^[A-Za-z0-9_-]+$/.test(subscription.keys.p256dh)
    && /^[A-Za-z0-9_-]+$/.test(subscription.keys.auth);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function showNotificationMenu(chatId, env, prefix = '') {
  const row = await env.DB.prepare('SELECT active FROM notification_subscribers WHERE chat_id = ?').bind(chatId).first();
  const active = row?.active === 1;
  const status = active
    ? 'Le notifiche sono attive. Ti avviserò quando si apre qualcosa di nuovo.'
    : 'Attiva le notifiche per sapere quando si sblocca un pensiero o arriva un aggiornamento.';
  return send(chatId, `${prefix ? `${prefix}\n\n` : ''}🔔 Notifiche di Casa Nostra\n${status}`, env, {
    inline_keyboard: [[
      active
        ? { text: '🔕 Disattiva notifiche', callback_data: 'notify:off' }
        : { text: '🔔 Attiva notifiche', callback_data: 'notify:on' }
    ]]
  });
}

async function subscribeNotifications(chatId, env) {
  if (!chatId) return;
  await env.DB.prepare(`INSERT INTO notification_subscribers (chat_id, active, subscribed_at, updated_at)
    VALUES (?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(chat_id) DO UPDATE SET active = 1, updated_at = datetime('now')`)
    .bind(chatId).run();
  return showNotificationMenu(chatId, env, 'Notifiche attivate 💗');
}

async function unsubscribeNotifications(chatId, env) {
  if (!chatId) return;
  await env.DB.prepare(`UPDATE notification_subscribers
    SET active = 0, updated_at = datetime('now') WHERE chat_id = ?`)
    .bind(chatId).run();
  return showNotificationMenu(chatId, env, 'Notifiche disattivate.');
}

async function notifySubscribers(env, text) {
  const { results = [] } = await env.DB.prepare(
    'SELECT chat_id FROM notification_subscribers WHERE active = 1'
  ).all();
  await Promise.all(results.map(async ({ chat_id: chatId }) => {
    try {
      const result = await send(String(chatId), text, env);
      if (!result?.ok) console.error('Unable to notify subscriber', chatId, result?.description);
    } catch (error) {
      console.error('Unable to notify subscriber', chatId, error);
    }
  }));
}

async function notifyUnlockedContent(env, scheduledTime) {
  const manifest = await readManifest(env);
  const now = Number(scheduledTime || Date.now());
  const recentWindow = 10 * 60 * 1000;
  const all = [...manifest.messages, ...manifest.surprises];

  for (const item of all) {
    const unlock = contentUnlockTimestamp(item, manifest);
    if (now < unlock || now - unlock > recentWindow) continue;
    const contentId = item.id || `${item.date}-${item.kind}-${item.time || ''}`;
    const stored = await env.DB.prepare(
      'INSERT OR IGNORE INTO notification_deliveries (content_id, delivered_at) VALUES (?, datetime(\'now\'))'
    ).bind(contentId).run();
    if (!stored.meta?.changes) continue;

    const messages = {
      morning: '☀️ Il buongiorno si è appena sbloccato',
      night: '🌙 La buonanotte si è appena sbloccata',
      surprise: '✨ Una sorpresa si è appena sbloccata'
    };
    const opening = messages[item.kind] || '💌 Un nuovo pensiero si è appena sbloccato';
    await Promise.all([
      notifySubscribers(
        env,
        `${opening} a Casa Nostra.\nÈ qui che ti aspetta 💗\n\n${siteUrl(env, item.kind)}`
      ),
      notifyWebPush(env, {
        title: 'Casa Nostra 💗',
        body: `${opening}. È qui che ti aspetta.`,
        tag: `unlock-${contentId}`,
        url: siteUrl(env, item.kind)
      })
    ]);
  }
}

async function notifyWebPush(env, payload) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.error('Web Push skipped: VAPID keys are missing');
    return;
  }
  webpush.setVapidDetails(
    String(env.VAPID_SUBJECT || siteUrl(env)),
    String(env.VAPID_PUBLIC_KEY),
    String(env.VAPID_PRIVATE_KEY)
  );
  const { results = [] } = await env.DB.prepare(
    'SELECT endpoint_hash, endpoint, p256dh, auth FROM web_push_subscriptions'
  ).all();
  await Promise.all(results.map(async row => {
    try {
      await webpush.sendNotification({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth }
      }, JSON.stringify(payload), { TTL: 86400 });
    } catch (error) {
      const statusCode = Number(error?.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        await env.DB.prepare('DELETE FROM web_push_subscriptions WHERE endpoint_hash = ?')
          .bind(row.endpoint_hash).run();
      } else {
        console.error('Web Push delivery failed', statusCode, error?.message || error);
      }
    }
  }));
}

function contentUnlockTimestamp(item, manifest) {
  const time = item.time || (item.kind === 'night'
    ? manifest.nightTime
    : item.kind === 'morning' ? manifest.morningTime : '00:00');
  const [year, month, day] = item.date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = target;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
      timeZone: manifest.timezone || 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(guess))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]));
    const shown = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    guess += target - shown;
  }
  return guess;
}

function siteUrl(env, kind = '') {
  const configured = String(env.PUBLIC_SITE_URL || 'https://aminhaidaoui.github.io/casa_clode/');
  const base = configured.split('#')[0];
  const anchor = kind === 'surprise' ? 'sorpreseDaLontano' : 'pensieriDiOggi';
  return `${base}#${anchor}`;
}

async function send(chatId, text, env, replyMarkup) {
  return telegram(env, 'sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
    disable_web_page_preview: true
  });
}

async function sendTelegram(env, text) {
  if (!botToken(env) || !adminChatId(env)) return;
  return send(adminChatId(env), text, env);
}

async function notifyActivity(payload, env, ctx) {
  const event = String(payload?.event || '').trim();
  const detail = String(payload?.detail || '').trim().toLowerCase();
  const months = new Set(['febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio']);
  const dailyKinds = new Set(['buongiorno', 'buonanotte']);
  const videoKinds = new Set(['ricordo', 'buongiorno', 'buonanotte', 'sorpresa']);
  const moods = new Map([
    ['bene', 'sta bene'],
    ['felice', 'è felice'],
    ['triste', 'è triste'],
    ['incazzata', 'è arrabbiata'],
    ['conme', 'è arrabbiata con te'],
    ['nostalgica', 'ha nostalgia'],
    ['ansiosa', 'si sente in ansia'],
    ['coccole', 'vorrebbe le coccole']
  ]);
  const audioCategories = new Set([
    'ansia', 'coccole', 'cosi', 'felice', 'incazzata',
    'mi-sento-sola', 'motivazione', 'nostalgia', 'sto-bene', 'triste'
  ]);
  let key = event;
  let message = '';
  let cooldown = 20;

  if (event === 'enter') {
    message = '🏠 Qualcuno è entrato a Casa Nostra';
    cooldown = 60;
  } else if (event === 'galaxy_open' && months.has(detail)) {
    key += `:${detail}`;
    message = `🌌 È stata aperta la galassia di ${detail}`;
  } else if (event === 'daily_open' && dailyKinds.has(detail)) {
    key += `:${detail}`;
    message = `💌 È stato aperto il ${detail}`;
  } else if (event === 'surprise_open') {
    message = '✨ È stata aperta una sorpresa';
  } else if (event === 'letter_open') {
    message = '✉️ È stata aperta una lettera';
  } else if (event === 'video_play' && videoKinds.has(detail)) {
    key += `:${detail}`;
    message = `🎬 È partito un video · ${detail}`;
  } else if (event === 'mood_select' && moods.has(detail)) {
    key += `:${detail}`;
    message = `💭 Oggi ha scelto: ${moods.get(detail)}`;
  } else if (event === 'audio_play' && audioCategories.has(detail)) {
    key += `:${detail}`;
    message = `🎧 Ha avviato una voce della stanza · ${detail.replaceAll('-', ' ')}`;
  } else if (event === 'game_complete') {
    message = '🎮 È stato completato un gioco di Casa Nostra';
  } else {
    return json({ ok: false, error: 'Unknown activity' }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(`INSERT INTO activity_notification_throttle (throttle_key, last_sent_at)
    VALUES (?, ?)
    ON CONFLICT(throttle_key) DO UPDATE SET last_sent_at = excluded.last_sent_at
    WHERE excluded.last_sent_at - activity_notification_throttle.last_sent_at >= ?`)
    .bind(key, now, cooldown).run();
  if (!result.meta?.changes) return json({ ok: true, skipped: 'throttled' });

  ctx.waitUntil(sendTelegram(env, `${message}\n🕰️ ${romeNow()}`));
  return json({ ok: true, sent: true });
}

async function telegram(env, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${botToken(env)}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function readManifest(env) {
  const content = await env.MEDIA.get(MANIFEST_KEY);
  if (!content) return structuredClone(DEFAULT_MANIFEST);
  try {
    const parsed = JSON.parse(content);
    return {
      ...structuredClone(DEFAULT_MANIFEST),
      ...parsed,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      surprises: Array.isArray(parsed.surprises) ? parsed.surprises : []
    };
  } catch {
    return structuredClone(DEFAULT_MANIFEST);
  }
}

async function writeManifest(manifest, env) {
  await env.MEDIA.put(MANIFEST_KEY, JSON.stringify(manifest, null, 2), {
    metadata: { contentType: 'application/json; charset=utf-8' }
  });
}

async function readState(chatId, env) {
  const row = await env.DB.prepare('SELECT payload FROM admin_states WHERE chat_id = ?').bind(chatId).first();
  if (!row?.payload) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

async function writeState(chatId, state, env) {
  await env.DB.prepare(`INSERT INTO admin_states (chat_id, payload, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(chat_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`)
    .bind(chatId, JSON.stringify(state)).run();
}

async function clearState(chatId, env) {
  await env.DB.prepare('DELETE FROM admin_states WHERE chat_id = ?').bind(chatId).run();
}

async function serveMedia(key, env) {
  const object = await env.MEDIA.getWithMetadata(decodeURIComponent(key), { type: 'stream' });
  if (!object.value) return new Response('Not found', { status: 404 });
  const headers = new Headers({ 'Content-Type': object.metadata?.contentType || 'application/octet-stream' });
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(object.value, { headers });
}

function cors(response, env) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', env.PUBLIC_SITE_ORIGIN || '*');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, { status: response.status, headers });
}

function isPublicSiteRequest(request, env) {
  const allowed = String(env.PUBLIC_SITE_ORIGIN || '').replace(/\/+$/, '');
  const origin = String(request.headers.get('Origin') || '').replace(/\/+$/, '');
  return Boolean(allowed && origin && origin === allowed);
}

function json(value, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { ...init, headers });
}

function extensionFor(mime, name = '') {
  const known = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  return known[mime] || name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function botToken(env) {
  return String(env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || '').trim();
}

function adminChatId(env) {
  return String(env.ADMIN_CHAT_ID || env.CHAT_ID || '').trim();
}

function romeNow() {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    dateStyle: 'full',
    timeStyle: 'medium'
  }).format(new Date());
}
