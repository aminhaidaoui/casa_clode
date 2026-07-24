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
    if (url.pathname.startsWith('/media/') && request.method === 'GET') {
      return serveMedia(url.pathname.slice('/media/'.length), env);
    }
    if (url.pathname === '/notify-entry' && request.method === 'POST') {
      ctx.waitUntil(sendTelegram(env, `💌 Qualcuno è entrato a Casa Nostra\n${romeNow()}`));
      return cors(json({ ok: true }), env);
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
    if (url.pathname === '/telegram/webhook' && request.method === 'POST') {
      if (!safeEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response('Forbidden', { status: 403 });
      }
      const update = await request.json();
      ctx.waitUntil(handleUpdate(update, env));
      return json({ ok: true });
    }
    return new Response('Not found', { status: 404 });
  }
};

async function handleUpdate(update, env) {
  const message = update.message;
  const callback = update.callback_query;
  const chatId = String(message?.chat?.id || callback?.message?.chat?.id || '');
  if (!chatId || !safeEqual(chatId, adminChatId(env))) return;

  if (callback) {
    await telegram(env, 'answerCallbackQuery', { callback_query_id: callback.id });
    return handleCallback(chatId, callback.data || '', env);
  }

  const text = (message?.text || '').trim();
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
    return send(chatId, '💌 Scrivi il pensiero o la letterina. Puoi anche scrivere /salta.', env);
  }
  if (state.step === 'note') {
    draft.note = text === '/salta' ? '' : text.slice(0, 4000);
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
  return send(chatId, `${labels[draft.kind]}\n📅 ${draft.date} alle ${draft.time} (ora italiana)\n\n${draft.title}\n${draft.note || ''}${media}\n\nVuoi programmarlo?`, env, {
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
  if (draft.media) {
    if (draft.media.type === 'video') item.video = draft.media.url;
    else item.image = draft.media.url;
  }
  const collection = draft.kind === 'surprise' ? manifest.surprises : manifest.messages;
  collection.push(item);
  collection.sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  await writeManifest(manifest, env);
  await clearState(chatId, env);
  await send(chatId, `✅ Programmato!\n${draft.date} alle ${draft.time} · ${draft.title}`, env);
  return showMenu(chatId, env);
}

async function showCalendar(chatId, env) {
  const manifest = await readManifest(env);
  const all = [...manifest.messages, ...manifest.surprises].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  if (!all.length) return showMenu(chatId, env, 'Il calendario è vuoto.');
  const icons = { morning: '☀️', night: '🌙', surprise: '✨' };
  const lines = all.slice(0, 30).map(item => `${icons[item.kind]} ${item.date} ${item.time} · ${item.title}`);
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
      [{ text: '📅 Calendario', callback_data: 'calendar' }]
    ]
  });
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
  return env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || '';
}

function adminChatId(env) {
  return env.ADMIN_CHAT_ID || env.CHAT_ID || '';
}

function romeNow() {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    dateStyle: 'full',
    timeStyle: 'medium'
  }).format(new Date());
}
