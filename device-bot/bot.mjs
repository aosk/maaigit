// MAAI device bot: WhatsApp (through WhatsApp Web on this device) ⇄ MAAI. See README.md.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import wweb from 'whatsapp-web.js';

const { Client, LocalAuth } = wweb;
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- Keeping itself running ----------

// However it was started ("npm start", "node bot.mjs", a startup .bat file), the bot runs as a child of a small
// watcher: when the bot updates itself it is started again on the new copy, and after a crash it starts again
// in 30 seconds. A setup problem (exit code 1) or Ctrl+C stops both.
if (!process.env.MAAI_LAUNCHER) {
  const run = () => {
    const bot = spawn(process.execPath, [path.join(HERE, 'bot.mjs')], { stdio: 'inherit', env: { ...process.env, MAAI_LAUNCHER: '1' } });
    bot.on('exit', (code) => {
      if (code === 75) {
        console.log('\n↻ Starting the updated bot…\n');
        run();
      } else if (code === 0 || code === 1 || code === null) {
        process.exit(code ?? 0);
      } else {
        console.log(`\n↻ The bot stopped (code ${code}). Starting it again in 30 seconds…\n`);
        setTimeout(run, 30_000);
      }
    });
  };
  process.on('SIGINT', () => {}); // Ctrl+C reaches the bot too; it closes WhatsApp and exits, then so does this.
  run();
  await new Promise(() => {}); // the watcher does nothing else
}

// ---------- Settings (from .env next to this file) ----------

const envFile = path.join(HERE, '.env');
// Text editors often save ".env" as ".env.txt" (Notepad) or ".env.rtf" (TextEdit): accept those too.
const envUsed = [envFile, `${envFile}.txt`].find((f) => fs.existsSync(f));
if (envUsed) {
  const text = fs.readFileSync(envUsed, 'utf8').replace(/^\uFEFF/, '');
  const fromFile = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*["']?(.*?)["']?\s*$/.exec(line);
    // The last line for a name wins, so a key added below an old one is the one used.
    if (m) fromFile[m[1]] = m[2];
  }
  // A value left empty in the terminal must not hide the one in the file.
  for (const [name, value] of Object.entries(fromFile)) if (!process.env[name]) process.env[name] = value;
}
const BASE = `${(process.env.MAAI_URL ?? '').replace(/\/+$/, '')}/bot/v1`;
const KEY = process.env.MAAI_BOT_KEY ?? '';
const XAI_KEY = process.env.XAI_API_KEY ?? '';
/** The Grok model to use: GROK_MODEL if xAI offers it, else the newest Grok model the key can use (found at start). */
let grokModel = process.env.GROK_MODEL || '';
const XAI_BASE = (process.env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/+$/, '');
const SYNC_MS = Math.max(5, Number(process.env.SYNC_MINUTES) || 60) * 60_000;
const DEVICE = 'WhatsApp bot';
/** Shown in MAAI's server log, so it is clear which copy of the bot is running. */
const VERSION = '2026-10-21k';
if (!/^https:\/\//.test(BASE) && !/^http:\/\/localhost/.test(BASE)) {
  const found = fs.readdirSync(HERE).filter((f) => f.startsWith('.env'));
  const where = !envUsed
    ? `No .env file in ${HERE} (found: ${found.join(', ') || 'none'}). ${found.some((f) => f.endsWith('.rtf')) ? 'TextEdit saved it as rich text: create it with the terminal command in README.md. ' : ''}`
    : `Read ${path.basename(envUsed)}, but its MAAI_URL line is missing or does not start with https:// (it must look like MAAI_URL=https://your-app.onrender.com, no spaces, no <>). `;
  fail(`MAAI_URL is missing. ${where}`);
}
if (!KEY.startsWith('maai_')) fail('MAAI_BOT_KEY is missing in .env (the key from MAAI → Admin portal → Device bot).');
// A full key is "maai_" and 43 more characters; the short "maai_xxxx…" in the status line is only a hint.
if (!/^maai_[\w-]{43}$/.test(KEY)) fail(`MAAI_BOT_KEY looks incomplete (${KEY.length} characters; a full key has 48, with no "…" or spaces). Make a new key, press Copy in the yellow box, and paste the whole of it.`);

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}
const log = (...args) => console.log(new Date().toLocaleTimeString(), ...args);
/** An error in one line, even when WhatsApp Web throws one with no message. */
const why = (error) => (error?.message || String(error ?? 'unknown')).split('\n')[0].slice(0, 200) || error?.name || 'unknown error';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- MAAI ----------

async function maai(method, route, body) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Waiting for commands holds the request open up to 25 s.
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  if (res.status === 401) fail(`MAAI refused the key ${KEY.slice(0, 9)}… It is not the newest one: only the last key made in the admin page works. Make a new key, then put it in .env.`);
  if (res.status === 404) fail('MAAI has no device key now (it was disconnected, or erased because the Render disk is missing). Make a new key.');
  if (!res.ok) throw new Error(`MAAI ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// ---------- WhatsApp ----------

/** A browser already on this computer (Chrome, then Edge), so nothing has to be downloaded. CHROME_PATH in .env wins. */
function findBrowser() {
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}
const browser = findBrowser();
if (browser) log(`Using the browser at ${browser}`);

const wa = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(HERE, '.wwebjs_auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox'], ...(browser ? { executablePath: browser } : {}) },
});

/** Messages waiting to be delivered (kept on disk so a restart loses nothing). */
const QUEUE_FILE = path.join(HERE, '.queue.json');
let queue = [];
try {
  queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
} catch {
  queue = [];
}
const keepQueue = () => fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue.slice(-2000)));

const digits = (id) => String(id ?? '').split('@')[0].replace(/\D/g, '');

/** Which WhatsApp chat each number MAAI knows is (newer WhatsApp hides some numbers behind "@lid" ids), kept on disk. */
const CHATS_FILE = path.join(HERE, '.chats.json');
let chatOf = {};
try {
  chatOf = JSON.parse(fs.readFileSync(CHATS_FILE, 'utf8'));
} catch {
  chatOf = {};
}
const keepChats = () => fs.writeFileSync(CHATS_FILE, JSON.stringify(chatOf));

/** Never lets a slow or failing WhatsApp lookup lose the message itself. */
const tryGet = (fn) => Promise.race([Promise.resolve().then(fn), new Promise((r) => setTimeout(r, 5000))]).catch(() => undefined);

const MEDIA = new Set(['ptt', 'audio', 'image', 'video', 'document', 'sticker']);

/** What this bot itself sent lately, so its own messages are not taken for the user answering. */
const sentByBot = [];
const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
function rememberSent(chatId, text) {
  sentByBot.push({ chatId, text: norm(text), at: Date.now() });
  while (sentByBot.length && Date.now() - sentByBot[0].at > 10 * 60_000) sentByBot.shift();
}
const isOurs = (chatId, text) => sentByBot.some((s) => s.chatId === chatId && s.text === norm(text));
const queued = new Set(queue.map((m) => m.id));

/** One WhatsApp message in the shape MAAI expects, or null for statuses, broadcasts and system notices. */
/** A WhatsApp id as text, whether WhatsApp Web gives a string or an id object. */
const idText = (x) => (typeof x === 'string' ? x : x?._serialized ?? (x?.user && x?.server ? `${x.user}@${x.server}` : ''));

async function toItem(msg, knownChat) {
  const chatId = idText(msg.fromMe ? msg.to : msg.from) || idText(msg.id?.remote);
  const body = typeof msg.body === 'string' ? msg.body : typeof msg._data?.body === 'string' ? msg._data.body : String(msg.caption ?? '');
  const messageId = idText(msg.id) || (msg.id?.id ? `${msg.fromMe ? 'true' : 'false'}_${chatId}_${msg.id.id}` : `${chatId}_${msg.timestamp ?? Date.now()}_${body.length}`);
  if (!chatId || msg.isStatus || msg.broadcast || /status@broadcast|@newsletter|@broadcast/.test(chatId)) return null;
  const media = msg.hasMedia || MEDIA.has(msg.type);
  if (!body && !media) return null;
  const group = chatId.endsWith('@g.us');
  if (msg.fromMe && group) return null;
  const chat = knownChat ?? (await tryGet(() => msg.getChat()));
  let phone = '';
  let from = '';
  if (msg.fromMe) {
    phone = chatId.endsWith('@c.us') ? digits(chatId) : digits((await tryGet(() => chat?.getContact()))?.number) || digits(chatId);
  } else {
    const contact = await tryGet(() => msg.getContact());
    const person = group ? idText(msg.author) : chatId;
    phone = digits(contact?.number) || digits(person);
    from = contact?.pushname || contact?.name || msg._data?.notifyName || '';
    if (group) from = `${from || `+${phone}`} · ${chat?.name ?? 'Group'}`;
    // Replies go back to this exact chat, whatever form its id takes.
    if (!group && phone && chatOf[phone] !== chatId) {
      chatOf[phone] = chatId;
      keepChats();
    }
  }
  return {
    id: messageId,
    byMaai: (msg.fromMe && isOurs(chatId, body)) || undefined,
    channel: 'whatsapp',
    from: from || undefined,
    phone: phone || undefined,
    text: body.slice(0, 4000),
    media: media || undefined,
    at: new Date((msg.timestamp || Date.now() / 1000) * 1000).toISOString(),
    group: group || undefined,
    fromMe: msg.fromMe || undefined,
  };
}

function add(item) {
  if (!item || queued.has(item.id)) return false;
  queued.add(item.id);
  queue.push(item);
  return true;
}

/**
 * When to deliver: a private message within a few seconds (several close together still go as one), anything
 * else (groups, your own messages) within two minutes. A later message never pushes an earlier delivery back.
 */
let soon;
let soonAt = Infinity;
const deliverSoon = (ms) => {
  const at = Date.now() + ms;
  if (at >= soonAt) return;
  clearTimeout(soon);
  soonAt = at;
  soon = setTimeout(() => {
    soonAt = Infinity;
    void sync();
  }, ms);
};

wa.on('qr', (qr) => {
  console.log('\nOpen WhatsApp on the phone → Linked devices → Link a device, and scan this:\n');
  qrcode.generate(qr, { small: true });
});
wa.on('authenticated', () => log('WhatsApp linked.'));
wa.on('auth_failure', (m) => fail(`WhatsApp sign-in failed: ${m}. Delete the .wwebjs_auth folder and scan again.`));
wa.on('disconnected', (why) => fail(`WhatsApp disconnected (${why}). Start the bot again and scan the QR.`));

// Every new message in every chat, including the user's own (those only tell MAAI the chat is answered).
// "message" (incoming only) is listened to as well: some WhatsApp Web versions fire only one of the two.
wa.on('message', (msg) => void onMessage(msg));
wa.on('message_create', (msg) => void onMessage(msg));
async function onMessage(msg) {
  try {
    const item = await toItem(msg);
    if (!item) {
      if (!msg.fromMe && process.env.DEBUG) log(`Skipped a "${msg.type}" message from ${msg.from}.`);
      return;
    }
    if (!add(item)) return;
    keepQueue();
    if (item.byMaai) return;
    if (!item.fromMe && !item.group) log(`New message from ${item.from ?? `+${item.phone}`}: sending to MAAI now.`);
    deliverSoon(!item.fromMe && !item.group ? 3000 : 120_000);
  } catch (error) {
    log('⚠ Could not read a message:', why(error));
  }
}

/** The phone's saved contacts (names and numbers only), so the assistant can find people by name. Once a day. */
async function shareContacts() {
  const all = await wa.getContacts();
  const contacts = all
    .filter((c) => c.isMyContact && !c.isGroup && !c.isMe && (c.number || c.id?.user))
    .map((c) => ({ name: c.name || c.pushname || '', phone: digits(c.number || c.id.user) }))
    .filter((c) => c.name && c.phone.length >= 8)
    .slice(0, 5000);
  const out = await maai('POST', '/contacts', { contacts });
  log(`Shared ${out.kept} contacts with MAAI (names and numbers only).`);
}

/** The last day of chats, read once when the bot starts, so MAAI also sees what arrived before (repeats are ignored by MAAI). */
const BACKFILL_HOURS = Math.max(1, Number(process.env.BACKFILL_HOURS) || 24);
async function backfill() {
  // Right after linking, WhatsApp Web is still loading the chats: wait, and try again a few times.
  let all;
  for (const wait of [10_000, 30_000, 60_000, 120_000]) {
    await pause(wait);
    try {
      all = await Promise.race([wa.getChats(), pause(60_000).then(() => Promise.reject(new Error('took too long')))]);
      break;
    } catch (error) {
      log(`Recent chats not ready yet (${why(error)}); trying again…`);
    }
  }
  if (!all) throw new Error('WhatsApp Web did not give the chat list. New messages still come through.');
  const since = Date.now() / 1000 - BACKFILL_HOURS * 3600;
  const chats = all.filter((c) => (c.timestamp ?? 0) >= since && !/@broadcast|@newsletter/.test(c.id?._serialized ?? '')).slice(0, 60);
  let found = 0;
  for (const chat of chats) {
    const messages = await tryGet(() => chat.fetchMessages({ limit: 15 }));
    for (const msg of messages ?? []) {
      if ((msg.timestamp ?? 0) < since) continue;
      if (add(await toItem(msg, chat).catch(() => null))) found += 1;
    }
  }
  keepQueue();
  log(`Read the last ${BACKFILL_HOURS} hours: ${found} message(s) in ${chats.length} chat(s).`);
}

// ---------- Commands from MAAI ----------

/** xAI's own explanation of a refused request, in one line. */
async function xaiError(res) {
  const body = await res.json().catch(() => ({}));
  const said = typeof body.error === 'string' ? body.error : body.error?.message ?? body.message ?? body.detail ?? '';
  const hint =
    res.status === 401 || res.status === 403 || /api key|unauthori[sz]ed|permission/i.test(said)
      ? ' Check XAI_API_KEY in .env (from console.x.ai → API Keys; it starts with "xai-"), and that the key has credit and model access.'
      : res.status === 404 || /model/i.test(said)
        ? ' The model is not available to this key: remove GROK_MODEL from .env and the bot picks one itself.'
        : res.status === 429
          ? ' Out of credit or too many requests: check console.x.ai → Billing.'
          : '';
  return `Grok refused (${res.status})${said ? `: ${String(said).slice(0, 200).replace(/[.\s]+$/, '')}` : ''}.${hint}`;
}

/**
 * At start: checks the xAI key and finds a model it can use, so a wrong key or model shows up straight away in
 * this window instead of only when a task fails.
 */
let lastGrokCheck = 0;
async function checkGrok() {
  lastGrokCheck = Date.now();
  if (!XAI_KEY) return log('Grok: no XAI_API_KEY in .env, so approved tasks are answered "not set up". (Optional.)');
  if (!XAI_KEY.startsWith('xai-')) log('⚠ Grok: XAI_API_KEY does not start with "xai-": check it was copied whole from console.x.ai.');
  const res = await fetch(`${XAI_BASE}/models`, { headers: { authorization: `Bearer ${XAI_KEY}` }, signal: AbortSignal.timeout(20_000) }).catch((e) => e);
  if (res instanceof Error) return log(`⚠ Grok: could not reach api.x.ai (${why(res)}). A firewall at work may block it.`);
  if (!res.ok) return log(`⚠ ${await xaiError(res)}`);
  const ids = ((await res.json().catch(() => ({}))).data ?? []).map((m) => m.id).filter((id) => typeof id === 'string');
  const chat = ids.filter((id) => /^grok/i.test(id) && !/image|vision|imagine|embed/i.test(id));
  if (grokModel && !ids.includes(grokModel)) {
    log(`⚠ Grok: model "${grokModel}" is not offered to this key; using another.`);
    grokModel = '';
  }
  // Newest first by the version in the name (grok-4 before grok-3…).
  if (!grokModel) grokModel = chat.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0] ?? '';
  log(grokModel ? `Grok ready: key accepted, model ${grokModel}.` : `⚠ Grok: the key works but offers no chat model (${ids.length} models).`);
}

async function grok(task) {
  if (!XAI_KEY) return { ok: false, output: 'No XAI_API_KEY on the device, so Grok cannot carry out tasks.' };
  // A failed start check is tried again at most every 10 minutes, not before every task.
  if (!grokModel && Date.now() - lastGrokCheck > 10 * 60_000) await checkGrok().catch(() => {});
  const res = await fetch(`${XAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${XAI_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: grokModel || 'grok-4',
      messages: [
        { role: 'system', content: "You are the user's device assistant. Carry out the task in writing (answer, draft, summary, plan). You cannot run programs, open files or send anything; if the task needs that, say exactly what the user should do. Be brief." },
        { role: 'user', content: task },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  }).catch((e) => e);
  if (res instanceof Error) return { ok: false, output: `Could not reach Grok (${why(res)}).` };
  if (!res.ok) return { ok: false, output: await xaiError(res) };
  const data = await res.json();
  const text = String(data.choices?.[0]?.message?.content ?? '').trim();
  return text ? { ok: true, output: text.slice(0, 4000) } : { ok: false, output: 'Grok answered with nothing.' };
}

async function handle(commands) {
  for (const c of commands ?? []) {
    let result;
    try {
      if (c.kind === 'reply') {
        if (!c.phone) throw new Error('No number');
        // MAAI's text is sent exactly as given; only one person, never a group.
        const target = chatOf[c.phone] ?? `${c.phone}@c.us`;
        rememberSent(target, c.text);
        await wa.sendMessage(target, c.text);
        log(`Sent to ${c.toName ?? `+${c.phone}`}`);
        result = { ok: true };
      } else if (c.kind === 'task') {
        log(`Task: ${c.text.slice(0, 80)}`);
        result = await grok(c.text);
      } else {
        result = { ok: false, output: 'Unknown command.' };
      }
    } catch (error) {
      result = { ok: false, output: String(error.message).slice(0, 500) };
    }
    await maai('POST', `/commands/${c.id}/result`, result).catch((e) => log(e.message));
  }
}

// ---------- The loops ----------

/**
 * Always waiting for MAAI: each request is held open by MAAI until a command is ready (or 25 s pass), so a
 * reply goes out the moment it is written. After an error, wait a little before asking again.
 */
async function listenForCommands() {
  for (;;) {
    try {
      const r = await maai('GET', `/commands?wait=25&device=${encodeURIComponent(DEVICE)}`);
      await handle(r.commands);
    } catch (error) {
      log('Waiting for commands failed, trying again in 10 s:', why(error));
      await pause(10_000);
    }
  }
}

let syncing = false;
async function sync() {
  if (syncing) return;
  syncing = true;
  try {
    do {
      const batch = queue.slice(0, 200);
      const out = await maai('POST', '/sync', { device: DEVICE, version: VERSION, messages: batch });
      queue = queue.slice(batch.length);
      for (const m of batch) queued.delete(m.id);
      keepQueue();
      // What MAAI could not use is described by its field types only (never the text), to find out why.
      if (out.skipped) log(`⚠ MAAI could not use ${out.skipped}. First one looked like: ${JSON.stringify(Object.fromEntries(Object.entries(batch[0] ?? {}).map(([k, v]) => [k, typeof v])))}`);
      if (batch.length || out.stored) log(`Sent ${batch.length} → MAAI kept ${out.stored} new (${out.repeats} it already had, ${out.own ?? 0} yours, ${out.skipped} unusable)${out.noted ? `; MAAI is writing ${out.noted} reply(ies)` : ''}.`);
      await handle(out.commands);
    } while (queue.length);
  } catch (error) {
    log('Delivery failed, trying again later:', error.message);
  } finally {
    syncing = false;
  }
}

wa.on('ready', async () => {
  log('WhatsApp ready. Reading recent chats…');
  await shareContacts().catch((error) => log('⚠ Could not share contacts:', why(error)));
  await checkGrok().catch((error) => log('⚠ Grok check failed:', why(error)));
  log('Listening for new messages. Reading the last day of chats in the background…');
  void backfill()
    .then(() => sync())
    .catch((error) => log('⚠ Could not read recent chats:', why(error)));
  setInterval(() => void shareContacts().catch(() => {}), 24 * 3_600_000);
  await sync();
  setInterval(sync, SYNC_MS);
  void listenForCommands();
  log(`Running: private messages reach MAAI within seconds and replies go out as soon as they are written. Leave this window open.`);
});

process.on('SIGINT', async () => {
  log('Stopping…');
  await wa.destroy().catch(() => {});
  process.exit(0);
});

await maai('GET', '/status')
  .then(() => log(`MAAI reachable, key accepted. Bot version ${VERSION}.`))
  .catch((error) => fail(`Could not reach MAAI at ${BASE} (${error.cause?.code ?? error.message}). Check MAAI_URL and the internet connection.`));

// ---------- Updating itself ----------

/** Asks to be started again with the new copy (start.mjs does that). */
const UPDATED = 75;

/**
 * Takes the newest bot from MAAI when it differs from this one: written next to this file, checked to be
 * valid JavaScript, the old copy kept as bot.mjs.bak, then restarted. Any problem: keep running as is.
 */
async function update() {
  const { version, code } = await maai('GET', '/script');
  if (version && version !== VERSION) log(`A newer bot is available (${version}); updating…`);
  if (!version || version === VERSION || typeof code !== 'string' || !code.includes("const VERSION = '")) return;
  const self = path.join(HERE, 'bot.mjs');
  const next = path.join(HERE, 'bot.next.mjs');
  fs.writeFileSync(next, code);
  try {
    execFileSync(process.execPath, ['--check', next], { stdio: 'ignore' });
  } catch {
    fs.rmSync(next, { force: true });
    log(`⚠ The update to ${version} did not check out; staying on ${VERSION}.`);
    return;
  }
  fs.copyFileSync(self, `${self}.bak`);
  // Writing over the running file can be refused for a moment (an antivirus checking the new file): try a few times.
  for (let attempt = 1; ; attempt++) {
    try {
      fs.copyFileSync(next, self);
      fs.rmSync(next, { force: true });
      break;
    } catch (error) {
      if (attempt >= 5) throw new Error(`could not replace bot.mjs (${why(error)}); download it again from GitHub`);
      await pause(3000);
    }
  }
  if (!process.env.MAAI_LAUNCHER) {
    log(`Updated to ${version}. Start the bot again with "npm start" to use it.`);
    return;
  }
  log(`Updated to ${version}. Restarting…`);
  await wa.destroy().catch(() => {});
  process.exit(UPDATED);
}

await update().catch((error) => log('Could not check for an update:', why(error)));
setInterval(() => void update().catch((error) => log('Could not check for an update:', why(error))), 15 * 60_000);
wa.initialize().catch((error) => {
  if (/Could not find Chrome|Failed to launch/i.test(error.message)) {
    fail('No browser for WhatsApp. Install Google Chrome (google.com/chrome), or put its path in .env as CHROME_PATH=C:\\...\\chrome.exe, then run npm start again.');
  }
  fail(`WhatsApp could not start: ${error.message.split('\n')[0]}`);
});
