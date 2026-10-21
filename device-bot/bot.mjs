// MAAI device bot: WhatsApp (through WhatsApp Web on this device) ⇄ MAAI. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import wweb from 'whatsapp-web.js';

const { Client, LocalAuth } = wweb;
const HERE = path.dirname(fileURLToPath(import.meta.url));

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
const GROK_MODEL = process.env.GROK_MODEL || 'grok-4';
const SYNC_MS = Math.max(5, Number(process.env.SYNC_MINUTES) || 60) * 60_000;
const DEVICE = 'WhatsApp bot';
/** Shown in MAAI's server log, so it is clear which copy of the bot is running. */
const VERSION = '2026-10-21d';
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

// ---------- MAAI ----------

async function maai(method, route, body) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
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
async function toItem(msg, knownChat) {
  const chatId = msg.fromMe ? msg.to : msg.from;
  if (!chatId || msg.isStatus || msg.broadcast || /status@broadcast|@newsletter|@broadcast/.test(chatId)) return null;
  const media = msg.hasMedia || MEDIA.has(msg.type);
  if (!msg.body && !media) return null;
  const group = chatId.endsWith('@g.us');
  if (msg.fromMe && group) return null;
  const chat = knownChat ?? (await tryGet(() => msg.getChat()));
  let phone = '';
  let from = '';
  if (msg.fromMe) {
    phone = chatId.endsWith('@c.us') ? digits(chatId) : digits((await tryGet(() => chat?.getContact()))?.number) || digits(chatId);
  } else {
    const contact = await tryGet(() => msg.getContact());
    const person = group ? msg.author : chatId;
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
    id: msg.id._serialized,
    byMaai: (msg.fromMe && isOurs(chatId, msg.body)) || undefined,
    channel: 'whatsapp',
    from: from || undefined,
    phone: phone || undefined,
    text: (msg.body ?? '').slice(0, 4000),
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

/** New messages go to MAAI about a minute after they arrive (several close together go as one). */
let soon;
const deliverSoon = () => {
  clearTimeout(soon);
  soon = setTimeout(() => void sync(), 60_000);
};

wa.on('qr', (qr) => {
  console.log('\nOpen WhatsApp on the phone → Linked devices → Link a device, and scan this:\n');
  qrcode.generate(qr, { small: true });
});
wa.on('authenticated', () => log('WhatsApp linked.'));
wa.on('auth_failure', (m) => fail(`WhatsApp sign-in failed: ${m}. Delete the .wwebjs_auth folder and scan again.`));
wa.on('disconnected', (why) => fail(`WhatsApp disconnected (${why}). Start the bot again and scan the QR.`));

// Every new message in every chat, including the user's own (those only tell MAAI the chat is answered).
wa.on('message_create', async (msg) => {
  try {
    const item = await toItem(msg);
    if (!item) {
      if (!msg.fromMe && process.env.DEBUG) log(`Skipped a "${msg.type}" message from ${msg.from}.`);
      return;
    }
    if (!add(item)) return;
    keepQueue();
    if (item.byMaai) return;
    if (!item.fromMe) log(`New message from ${item.from ?? `+${item.phone}`}${item.group ? ' (group)' : ''}: sending to MAAI in a minute.`);
    deliverSoon();
  } catch (error) {
    log('⚠ Could not read a message:', error.message);
  }
});

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
  const since = Date.now() / 1000 - BACKFILL_HOURS * 3600;
  const chats = (await wa.getChats()).filter((c) => (c.timestamp ?? 0) >= since && !/@broadcast|@newsletter/.test(c.id?._serialized ?? '')).slice(0, 60);
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

async function grok(task) {
  if (!XAI_KEY) return { ok: false, output: 'No XAI_API_KEY on the device, so Grok cannot carry out tasks.' };
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${XAI_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages: [
        { role: 'system', content: "You are the user's device assistant. Carry out the task in writing (answer, draft, summary, plan). You cannot run programs, open files or send anything; if the task needs that, say exactly what the user should do. Be brief." },
        { role: 'user', content: task },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) return { ok: false, output: `Grok refused (${res.status}).` };
  const data = await res.json();
  return { ok: true, output: String(data.choices?.[0]?.message?.content ?? '').slice(0, 4000) };
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

const pollCommands = () => maai('GET', `/commands?device=${encodeURIComponent(DEVICE)}`).then((r) => handle(r.commands)).catch((e) => log(e.message));

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
      if (batch.length || out.stored) log(`Sent ${batch.length} → MAAI kept ${out.stored} new (${out.repeats} it already had, ${out.own ?? 0} yours, ${out.skipped} unusable)${out.noted ? `; MAAI is writing ${out.noted} reply(ies)` : ''}.`);
      await handle(out.commands);
      // MAAI writes its first replies in the background: collect them in a few seconds, not a minute.
      if (out.noted) setTimeout(() => void pollCommands(), 15_000);
    } while (queue.length);
  } catch (error) {
    log('Delivery failed, trying again later:', error.message);
  } finally {
    syncing = false;
  }
}

wa.on('ready', async () => {
  log('WhatsApp ready. Reading recent chats…');
  await backfill().catch((error) => log('⚠ Could not read recent chats:', error.message));
  await shareContacts().catch((error) => log('⚠ Could not share contacts:', error.message));
  setInterval(() => void shareContacts().catch(() => {}), 24 * 3_600_000);
  await sync();
  setInterval(sync, SYNC_MS);
  setInterval(() => void pollCommands(), 60_000);
  log(`Running: new messages reach MAAI within about a minute (and everything again every ${SYNC_MS / 60_000} minutes); commands are checked every minute. Leave this window open.`);
});

process.on('SIGINT', async () => {
  log('Stopping…');
  await wa.destroy().catch(() => {});
  process.exit(0);
});

await maai('GET', '/status')
  .then(() => log(`MAAI reachable, key accepted. Bot version ${VERSION}.`))
  .catch((error) => fail(`Could not reach MAAI at ${BASE} (${error.cause?.code ?? error.message}). Check MAAI_URL and the internet connection.`));
wa.initialize().catch((error) => {
  if (/Could not find Chrome|Failed to launch/i.test(error.message)) {
    fail('No browser for WhatsApp. Install Google Chrome (google.com/chrome), or put its path in .env as CHROME_PATH=C:\\...\\chrome.exe, then run npm start again.');
  }
  fail(`WhatsApp could not start: ${error.message.split('\n')[0]}`);
});
