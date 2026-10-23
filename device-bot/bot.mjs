// MAAI device bot: WhatsApp (through WhatsApp Web on this device) ⇄ MAAI. See README.md.
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import wweb from 'whatsapp-web.js';

const { Client, LocalAuth, MessageMedia } = wweb;
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
const VERSION = '2026-10-24h';
if (!/^https:\/\//.test(BASE) && !/^http:\/\/localhost(:\d+)?\//.test(BASE)) {
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

// An error nothing caught (WhatsApp Web reloading mid-call, a dropped connection) would end Node with code 1,
// which the watcher reads as a setup problem and stops for good. Restart instead (code 2: again in 30 s).
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (error) => {
    console.error(new Date().toLocaleTimeString(), `✗ Unexpected error (${event}): ${error?.message ?? error}. Starting again in 30 seconds…`);
    process.exit(2);
  });
}
/** An error in one line, even when WhatsApp Web throws one with no message. */
const why = (error) => (error?.message || String(error ?? 'unknown')).split('\n')[0].slice(0, 200) || error?.name || 'unknown error';

// ---------- One copy at a time, and starting with Windows ----------

// Two copies would fight over the same WhatsApp session. Each running copy keeps .bot.lock fresh; a lock left
// behind by a copy that crashed (or a computer that was switched off) is old and taken over.
const LOCK = path.join(HERE, '.bot.lock');
const LOCK_FRESH_MS = 3 * 60_000;
try {
  const other = Number(fs.readFileSync(LOCK, 'utf8'));
  const fresh = Date.now() - fs.statSync(LOCK).mtimeMs < LOCK_FRESH_MS;
  let alive = false;
  try {
    alive = other > 0 && other !== process.pid && (process.kill(other, 0), true);
  } catch {}
  if (alive && fresh) {
    console.log(`\nThe bot is already running in another window (process ${other}). This copy stops; nothing to do.\n`);
    process.exit(0);
  }
} catch {}
const holdLock = () => {
  try {
    fs.writeFileSync(LOCK, String(process.pid));
  } catch {}
};
holdLock();
setInterval(holdLock, 60_000).unref();
process.on('exit', () => {
  try {
    if (fs.readFileSync(LOCK, 'utf8') === String(process.pid)) fs.unlinkSync(LOCK);
  } catch {}
});

/**
 * On Windows the bot starts by itself when the user signs in: a small "MAAI bot.cmd" in the Startup folder
 * opens it in a minimised window. START_WITH_WINDOWS=off in .env removes it.
 */
function startWithWindows() {
  if (process.platform !== 'win32' || !process.env.APPDATA) return;
  const dir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const file = path.join(dir, 'MAAI bot.cmd');
  if (/^(off|no|false|0)$/i.test(process.env.START_WITH_WINDOWS ?? '')) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      log('No longer starts with Windows (START_WITH_WINDOWS=off).');
    }
    return;
  }
  if (!fs.existsSync(dir)) return;
  const cmd = (p) => p.replace(/%/g, '%%');
  const text = [
    '@echo off',
    'rem Starts the MAAI WhatsApp bot when you sign in to Windows. Made by the bot; set START_WITH_WINDOWS=off in its .env to stop it.',
    'chcp 65001 >nul',
    `cd /d "${cmd(HERE)}"`,
    `start "MAAI bot" /min "${cmd(process.execPath)}" "${cmd(path.join(HERE, 'bot.mjs'))}"`,
    '',
  ].join('\r\n');
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  fs.writeFileSync(file, text);
  log('✓ From now on the bot starts by itself when you sign in to Windows (minimised window "MAAI bot").');
}
try {
  startWithWindows();
} catch (error) {
  log('⚠ Could not set the bot to start with Windows:', why(error));
}
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
  // Only the key check says "no key": a 404 elsewhere (an old command, a missing file) is an ordinary error.
  if (res.status === 404 && route === '/status') fail('MAAI has no device key now (it was disconnected, or erased because the Render disk is missing). Make a new key.');
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

// The user's own WhatsApp number (MY_PHONE in .env, else remembered from the last time it was linked). With it,
// linking needs no QR: WhatsApp gives an 8-letter code that MAAI shows on the phone, typed in under
// WhatsApp → Linked devices → Link with phone number instead.
const ME_FILE = path.join(HERE, '.me');
const myPhone = (process.env.MY_PHONE || (fs.existsSync(ME_FILE) ? fs.readFileSync(ME_FILE, 'utf8') : '')).replace(/\D/g, '').replace(/^00/, '').replace(/^0(5\d{8})$/, '966$1');
const wa = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(HERE, '.wwebjs_auth') }),
  // Chrome's sandbox stays on (it shows content from strangers); it is only switched off on Linux, where Chrome
  // cannot start without it when run as root.
  puppeteer: { headless: true, args: process.platform === 'linux' ? ['--no-sandbox'] : [], ...(browser ? { executablePath: browser } : {}) },
  ...(myPhone.length >= 10 ? { pairWithPhoneNumber: { phoneNumber: myPhone, showNotification: true, intervalMs: 180_000 } } : {}),
});
/** Closes WhatsApp's hidden browser (at most 10 s), so the next start can open the same session. */
const closeWhatsApp = () => Promise.race([wa.destroy().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);

/**
 * A hidden browser left open by an earlier run (the computer slept, the window was closed) still holds the
 * WhatsApp session, and the new one cannot open it. Only one bot runs at a time (.bot.lock), so any browser
 * using this bot's session folder is left over: close it. The user's own Chrome is not touched.
 */
function closeLeftoverBrowser() {
  if (process.platform !== 'win32') return;
  const folder = path.join(HERE, '.wwebjs_auth').toLowerCase().replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process -Filter "name='chrome.exe' or name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${folder}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
    const closed = out.split(/\s+/).filter(Boolean).length;
    if (closed) log(`Closed ${closed} leftover WhatsApp browser process(es) from an earlier run.`);
  } catch {}
}

/** Tells MAAI whether WhatsApp needs linking, so it can show the code (or say to scan the QR) on the phone. */
const tellLink = (body) => maai('POST', '/link', body).catch((error) => log('⚠ Could not tell MAAI about linking:', why(error)));

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

/**
 * The real phone number behind a WhatsApp id. Newer WhatsApp often names a person by a hidden id ("…@lid")
 * instead of their number, and then the contact's "number" is that hidden id too: ask WhatsApp for the real
 * one, so MAAI sees the same number the user saved (the order number, contacts, replies). Kept per run.
 */
const realNumbers = new Map();
async function phoneOf(id, contact) {
  if (!id) return digits(contact?.number);
  if (id.endsWith('@c.us')) return digits(id);
  if (!id.endsWith('@lid')) return digits(contact?.number) || digits(id);
  if (!realNumbers.has(id)) {
    const [found] = (await tryGet(() => wa.getContactLidAndPhone([id]))) ?? [];
    const pn = found?.pn && found.pn.endsWith('@c.us') ? digits(found.pn) : '';
    if (pn) realNumbers.set(id, pn);
    else return digits(contact?.number) || digits(id);
  }
  return realNumbers.get(id);
}

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
    phone = await phoneOf(chatId, chatId.endsWith('@c.us') ? null : await tryGet(() => chat?.getContact()));
  } else {
    const contact = await tryGet(() => msg.getContact());
    const person = group ? idText(msg.author) : chatId;
    phone = await phoneOf(person, contact);
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

let qrTold = false;
wa.on('qr', (qr) => {
  console.log('\nOpen WhatsApp on the phone → Linked devices → Link a device, and scan this:\n');
  qrcode.generate(qr, { small: true });
  console.log('Tip: put MY_PHONE=9665XXXXXXXX in .env and MAAI shows you a code to type instead of scanning.\n');
  if (!qrTold) void tellLink({ qr: true });
  qrTold = true;
});
wa.on('code', (code) => {
  const shown = `${code.slice(0, 4)}-${code.slice(4)}`;
  console.log(`\nWhatsApp needs linking. On the phone: WhatsApp → Linked devices → Link a device → Link with phone number instead, and type:\n\n    ${shown}\n\n(also shown in MAAI; a new code comes every 3 minutes)\n`);
  void tellLink({ code });
});
wa.on('authenticated', () => log('WhatsApp linked.'));
// A lost link is not the end: the watcher starts the bot again in 30 seconds, and if WhatsApp was signed out
// it asks for a new code (shown in MAAI) instead of stopping for good.
wa.on('auth_failure', (m) => {
  log(`⚠ WhatsApp sign-in failed (${m}). Starting again to link anew…`);
  void closeWhatsApp().finally(() => process.exit(2));
});
wa.on('disconnected', (reason) => {
  log(`⚠ WhatsApp disconnected (${reason}). Starting again in 30 seconds…`);
  void Promise.all([tellLink({ lost: String(reason).slice(0, 60) }), closeWhatsApp()]).finally(() => process.exit(2));
});

// Every new message in every chat, including the user's own (those only tell MAAI the chat is answered).
// "message" (incoming only) is listened to as well: some WhatsApp Web versions fire only one of the two.
wa.on('message', (msg) => void onMessage(msg));
wa.on('message_create', (msg) => void onMessage(msg));
// ---------- Voice orders ----------

/** The user's order number, as MAAI says on every delivery: only its voice notes are sent to MAAI as audio. */
let orderPhone = '';
const voiceSent = new Set();
/** Longest voice note sent (about 3 minutes): longer ones get a note back instead. */
const MAX_VOICE_BYTES = 3 * 1024 * 1024;

/** A voice note from the order number goes to MAAI as audio, to be written out and carried out as an order. */
/**
 * Downloads and decrypts a WhatsApp voice note (or other media) straight from WhatsApp's media servers, the
 * documented way (HKDF-SHA256 on the message's media key, AES-256-CBC, a 10-byte HMAC check), without going
 * through WhatsApp Web's own code, which the library cannot always call ("r" errors when they change).
 */
const MEDIA_INFO = { ptt: 'WhatsApp Audio Keys', audio: 'WhatsApp Audio Keys', image: 'WhatsApp Image Keys', video: 'WhatsApp Video Keys', document: 'WhatsApp Document Keys' };
async function downloadDirect(m) {
  const mediaKey = m.mediaKey ?? m._data?.mediaKey;
  const directPath = m._data?.directPath ?? m.directPath;
  if (!mediaKey || !directPath) throw new Error('no-media-key');
  const keys = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(mediaKey, 'base64'), Buffer.alloc(0), MEDIA_INFO[m.type] ?? MEDIA_INFO.ptt, 112));
  const iv = keys.subarray(0, 16);
  const res = await fetch(`https://mmg.whatsapp.net${directPath}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`media-server-${res.status}`);
  const encrypted = Buffer.from(await res.arrayBuffer());
  const body = encrypted.subarray(0, -10);
  const mac = crypto.createHmac('sha256', keys.subarray(48, 80)).update(iv).update(body).digest().subarray(0, 10);
  if (!mac.equals(encrypted.subarray(-10))) throw new Error('media-check-failed');
  const decipher = crypto.createDecipheriv('aes-256-cbc', keys.subarray(16, 48), iv);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

async function sendVoice(msg, item) {
  if (voiceSent.has(item.id)) return;
  voiceSent.add(item.id); // the same note arrives through two events: claim it now, give it back if it fails
  // The message as it first arrives often lacks its media details yet (then the library returns nothing
  // without trying), so each try reads the message afresh. Up to 4 tries, 30 seconds each.
  let audio = null;
  let reason = 'download';
  const msgId = idText(msg.id);
  for (let attempt = 1; attempt <= 4 && !audio?.length; attempt++) {
    if (attempt > 1) await pause(attempt * 3000);
    const fresh = (msgId && (await tryGet(() => wa.getMessageById(msgId)))) || msg;
    if (!fresh.hasMedia) {
      reason = 'no-media-yet';
      continue;
    }
    // First straight from WhatsApp's media servers; the library's own way only if that fails.
    const direct = await downloadDirect(fresh).catch((error) => error);
    if (Buffer.isBuffer(direct) && direct.length) {
      audio = direct;
      break;
    }
    reason = `direct-${why(direct).replace(/[^\w-]+/g, '-').slice(0, 30)}`;
    const media = await Promise.race([
      fresh.downloadMedia().catch((error) => ({ error })),
      pause(30_000).then(() => ({ error: new Error('timeout') })),
    ]);
    if (media?.data) audio = Buffer.from(media.data, 'base64');
    else reason += media?.error ? `-lib-${why(media.error).replace(/[^\w-]+/g, '-').slice(0, 20)}` : '-lib-none';
  }
  const query = (extra) => new URLSearchParams({ id: item.id, at: item.at, phone: item.phone, ...extra });
  const post = (params, body) =>
    fetch(`${BASE}/voice?${query(params)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'audio/ogg' },
      body,
      signal: AbortSignal.timeout(60_000),
    }).catch((e) => e);
  // What went wrong is told to MAAI, which answers the user on WhatsApp (so a voice order never just vanishes).
  if (!audio?.length || audio.length > MAX_VOICE_BYTES) {
    if (audio?.length) reason = 'too-long';
    log(reason === 'too-long' ? '⚠ A voice order was too long (over about 3 minutes).' : `⚠ WhatsApp did not hand over a voice order (${reason}).`);
    await post({ failed: reason }, Buffer.alloc(0));
    if (reason !== 'too-long') voiceSent.delete(item.id);
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await post({}, audio);
    if (!(res instanceof Error) && res.ok) return log('Voice order sent to MAAI.');
    log(`⚠ Could not send a voice order to MAAI (${res instanceof Error ? why(res) : res.status})${attempt < 3 ? '; trying again…' : '.'}`);
    if (attempt < 3) await pause(attempt * 10_000);
  }
  voiceSent.delete(item.id);
  // MAAI cannot be reached: say so on WhatsApp straight from here.
  const notice = '🤖 MAAI\nما قدرت أوصل رسالتك الصوتية لـ MAAI. أرسلها مرة ثانية بعد قليل أو اكتبها.\nCould not pass your voice note to MAAI. Send it again in a moment, or type it.';
  rememberSent(msg.from, notice);
  await wa.sendMessage(msg.from, notice).catch(() => {});
}

async function onMessage(msg) {
  try {
    const item = await toItem(msg);
    if (item && orderPhone && item.phone === orderPhone && !item.fromMe && !item.group && (msg.type === 'ptt' || msg.type === 'audio')) {
      await sendVoice(msg, item);
      return;
    }
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
  // Right after linking WhatsApp Web may not have loaded the contacts yet: an empty list would replace the saved one.
  if (!contacts.length) return log('Contacts not loaded yet; keeping the list MAAI has.');
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
  // The main models are numbered (grok-4, grok-4.1…): the newest of those, a full one before a "mini" or
  // "fast" one; special-purpose models (code, build…) only if there is nothing else.
  const version = (id) => Number(/^grok-(\d+(?:\.\d+)?)/i.exec(id)?.[1] ?? -1);
  const lighter = (id) => /mini|fast|lite/i.test(id);
  const numbered = chat.filter((id) => version(id) >= 0 && !/code|build/i.test(id));
  const ranked = numbered.sort((a, b) => version(b) - version(a) || Number(lighter(a)) - Number(lighter(b)) || a.length - b.length);
  if (!grokModel) grokModel = ranked[0] ?? chat[0] ?? '';
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

// ---------- Actions on this computer (each one approved by the user in MAAI) ----------

const HOME = os.homedir();
/**
 * The only folders the bot opens or sends files from: ALLOWED_FOLDERS in .env (separated by ";"), else
 * Documents, Desktop and Downloads (also the OneDrive copies Windows often uses instead).
 */
const ALLOWED = [
  ...new Set(
    (process.env.ALLOWED_FOLDERS
      ? process.env.ALLOWED_FOLDERS.split(';')
      : ['Documents', 'Desktop', 'Downloads'].flatMap((f) => [path.join(HOME, f), path.join(HOME, 'OneDrive', f)])
    )
      .map((f) => f.trim().replace(/^~(?=$|[\\/])/, HOME))
      .filter((f) => f && fs.existsSync(f))
      .map((f) => fs.realpathSync(path.resolve(f))),
  ),
];
/** Files the bot opens: documents, pictures, sound and video only (anything else could run something). */
const OPENABLE = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|csv|md|png|jpe?g|gif|webp|heic|bmp|tiff?|mp3|m4a|wav|ogg|mp4|mov|avi|mkv|zip)$/i;
/** Network shares and device paths: never touched (even checking them can send the Windows sign-in to another machine). */
const FAR_AWAY = /^(\\\\|\/\/|\\\\\?\\|\\\\\.\\)/;
/** Files that would run something when opened: never opened, and named in the refusal. */
const RUNNABLE = /\.(exe|com|bat|cmd|ps1|psm1|psd1|vbs|vbe|js|jse|mjs|cjs|wsf|wsh|msi|msp|msix|appx|scr|pif|lnk|url|reg|hta|cpl|jar|appref-ms|application|gadget|msc|inf|scf|sh|app|command|workflow|py|pyw|iso|img|vhd|vhdx)$/i;
const MAX_FILE_MB = 60;

const within = (root, file) => {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const inside = (file) => ALLOWED.some((root) => within(root, file));
/** "Documents\\Reports\\q4.pdf": where a file is, without the rest of the computer's paths. */
const shown = (file) => {
  const root = ALLOWED.find((r) => within(r, file));
  return root ? path.join(path.basename(root), path.relative(root, file)) : path.basename(file);
};

/** Files and folders under the allowed folders whose name matches, exact names first (a few levels deep, hidden folders skipped). */
async function search(name) {
  const want = name.toLowerCase();
  const exact = [];
  const partial = [];
  let seen = 0;
  const queue = ALLOWED.map((dir) => ({ dir, depth: 0 }));
  while (queue.length && seen < 30_000 && exact.length < 10) {
    const { dir, depth } = queue.shift();
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      seen++;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      const lower = e.name.toLowerCase();
      if (lower === want || lower.replace(/\.[^.]+$/, '') === want) exact.push(full);
      else if (lower.includes(want)) partial.push(full);
      if (e.isDirectory() && depth < 5) queue.push({ dir: full, depth: depth + 1 });
    }
  }
  return exact.length ? exact : partial;
}

/** The one file or folder the user meant, inside the allowed folders, or an error saying what to do. */
async function findTarget(target) {
  const given = target.trim().replace(/^["']|["']$/g, '').replace(/^~(?=$|[\\/])/, HOME);
  if (FAR_AWAY.test(given)) throw new Error('Network and device paths are not used. Name a file in your allowed folders.');
  if (!ALLOWED.length) throw new Error('No allowed folders on this computer. Set ALLOWED_FOLDERS in .env (for example C:\\Users\\you\\Documents).');
  const where = ALLOWED.map((f) => path.basename(f)).join(', ');
  const tries = path.isAbsolute(given) ? [given] : ALLOWED.map((root) => path.join(root, given));
  const there = [...new Set(tries.filter((t) => fs.existsSync(t)).map((t) => fs.realpathSync(t)))];
  if (there.length && !there.some(inside)) throw new Error(`That is outside the folders the bot may use (${where}). To allow it, add its folder to ALLOWED_FOLDERS in .env.`);
  const name = path.basename(given);
  if (!name) throw new Error('Give a file or folder name.');
  const found = there.length ? there.filter(inside) : (await search(name)).map((f) => fs.realpathSync(f)).filter(inside);
  if (!found.length) throw new Error(`Found nothing named "${name}" in ${where}.`);
  if (found.length > 1) throw new Error(`Several match "${name}"; say which one:\n${found.slice(0, 5).map((f) => `- ${shown(f)}`).join('\n')}`);
  return found[0];
}

/** Hands a link or file to the computer's own default app (browser, viewer, Explorer). Nothing passes through a shell. */
function openWithDefault(target, isLink) {
  const [cmd, args] =
    process.platform === 'win32'
      ? isLink ? ['rundll32.exe', ['url.dll,FileProtocolHandler', target]] : ['explorer.exe', [target]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [target]];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    // Explorer reports exit code 1 even when it worked: give it a moment and take it as started.
    setTimeout(resolve, 500);
    child.unref();
  });
}

async function act(action, target) {
  if (action === 'open_url') {
    const url = new URL(target);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only web links are opened.');
    await openWithDefault(url.href, true);
    log(`Opened ${url.host}`);
    return { ok: true, output: `Opened ${url.href} in the browser.` };
  }
  const file = await findTarget(target);
  const stat = fs.statSync(file);
  if (action === 'open_path') {
    if (stat.isFile() && RUNNABLE.test(file)) throw new Error(`"${path.basename(file)}" is a program or script; the bot never runs those.`);
    if (stat.isFile() && !OPENABLE.test(file)) throw new Error(`The bot opens documents, pictures, sound and video only, not "${path.extname(file) || 'this kind of'}" files. Open it yourself.`);
    await openWithDefault(file, false);
    log(`Opened ${shown(file)}`);
    return { ok: true, output: `Opened ${shown(file)}.` };
  }
  if (action === 'send_file') {
    if (!stat.isFile()) throw new Error(`"${path.basename(file)}" is a folder; name one file in it.`);
    if (stat.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`"${path.basename(file)}" is ${Math.round(stat.size / 1048576)} MB; the bot sends files up to ${MAX_FILE_MB} MB.`);
    const me = idText(wa.info?.wid);
    if (!me) throw new Error('WhatsApp is not ready yet; try again in a minute.');
    const caption = `📎 ${path.basename(file)} (MAAI)`;
    rememberSent(me, caption);
    // Only ever to the user's own chat ("Message yourself"), never to anyone else.
    await wa.sendMessage(me, MessageMedia.fromFilePath(file), { sendMediaAsDocument: true, caption });
    log(`Sent ${shown(file)} to your own WhatsApp chat`);
    return { ok: true, output: `Sent ${shown(file)} to the user's own WhatsApp chat.` };
  }
  throw new Error('Unknown action.');
}

/** Commands being carried out right now: a restart or an update waits for them (a reply half-sent is never cut off). */
let busyCommands = 0;
async function whenIdle(maxMs = 2 * 60_000) {
  for (const start = Date.now(); busyCommands > 0 && Date.now() - start < maxMs; ) await pause(500);
}

async function handle(commands) {
  busyCommands++;
  try {
    await handleAll(commands);
  } finally {
    busyCommands--;
  }
}

async function handleAll(commands) {
  let restart = false;
  for (const c of commands ?? []) {
    let result;
    try {
      if (c.kind === 'restart') {
        // Asked from MAAI's admin page: start again (WhatsApp stays linked), once this round's results are in.
        restart = true;
        result = { ok: true, output: 'Restarting.' };
      } else if (c.kind === 'reply') {
        if (!c.phone) throw new Error('No number');
        // MAAI's text is sent exactly as given; only one person, never a group.
        // A chat MAAI has seen is answered there; anyone else is looked up first: newer WhatsApp refuses
        // "number@c.us" for a person it knows by a hidden id ("No LID for user").
        const found = chatOf[c.phone] ? null : await tryGet(() => wa.getNumberId(c.phone));
        if (!chatOf[c.phone] && found === null) throw new Error(`+${c.phone} is not on WhatsApp`);
        const target = chatOf[c.phone] || idText(found) || `${c.phone}@c.us`;
        rememberSent(target, c.text);
        await wa.sendMessage(target, c.text);
        log(`Sent to ${c.toName ?? `+${c.phone}`}`);
        result = { ok: true };
      } else if (c.kind === 'task' && c.action) {
        log(`Action ${c.action}: ${c.text.slice(0, 80)}`);
        result = await act(c.action, c.text);
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
  if (restart) {
    log('Restart asked from MAAI. Starting again…');
    busyCommands--; // this round is done; wait only for others
    await whenIdle();
    await closeWhatsApp();
    process.exit(process.env.MAAI_LAUNCHER ? UPDATED : 2);
  }
}

/** MAAI says which bot is newest with every answer: a different one is taken at once, not at the next 15-minute check. */
// A version that could not be taken is tried again only at the 15-minute check, not every 25 seconds.
const triedAt = new Map();
function newestIs(latest) {
  if (typeof latest !== 'string' || !latest || latest === VERSION || Date.now() - (triedAt.get(latest) ?? 0) < 15 * 60_000) return;
  triedAt.set(latest, Date.now());
  void update().catch((error) => log('Could not update:', why(error)));
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
      newestIs(r.latest);
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
      orderPhone = typeof out.orderPhone === 'string' ? out.orderPhone : '';
      newestIs(out.latest);
      queue = queue.slice(batch.length);
      for (const m of batch) queued.delete(m.id);
      keepQueue();
      // What MAAI could not use is described by its field types only (never the text), to find out why.
      if (out.skipped) log(`⚠ MAAI could not use ${out.skipped}. First one looked like: ${JSON.stringify(Object.fromEntries(Object.entries(batch[0] ?? {}).map(([k, v]) => [k, typeof v])))}`);
      if (batch.length || out.stored) log(`Sent ${batch.length} → MAAI kept ${out.stored} new (${out.repeats} it already had, ${out.own ?? 0} yours, ${out.skipped} unusable)${out.noted ? `; MAAI is writing ${out.noted} reply(ies)` : ''}.`);
      await handle(out.commands);
    } while (queue.length);
  } catch (error) {
    log('Delivery failed, trying again in a minute:', error.message);
    deliverSoon(60_000);
  } finally {
    syncing = false;
  }
}

// WhatsApp fires "ready" again whenever WhatsApp Web reloads its page. The loops below must start only once:
// a second set would ask MAAI for commands twice and could carry one out twice.
let started = false;
wa.on('ready', async () => {
  if (started) return log('WhatsApp ready again (WhatsApp Web reloaded). Still listening.');
  started = true;
  log('WhatsApp ready. Reading recent chats…');
  const me = idText(wa.info?.wid).split('@')[0].replace(/\D/g, '');
  if (me && me !== myPhone) fs.writeFileSync(ME_FILE, me);
  void tellLink({ linked: true });
  await shareContacts().catch((error) => log('⚠ Could not share contacts:', why(error)));
  await checkGrok().catch((error) => log('⚠ Grok check failed:', why(error)));
  log(ALLOWED.length ? `Files it may open or send you (each one approved in MAAI): ${ALLOWED.join(', ')}` : '⚠ No allowed folders: set ALLOWED_FOLDERS in .env to open or send files.');
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
  await closeWhatsApp();
  process.exit(0);
});

// Right after Windows starts the internet may not be up yet, and MAAI may be waking up: keep trying, waiting a
// little longer each time (up to 5 minutes). Only a refused key (handled in maai()) stops the bot.
for (let attempt = 1; ; attempt++) {
  const error = await maai('GET', '/status').then(() => null, (e) => e);
  if (!error) {
    log(`MAAI reachable, key accepted. Bot version ${VERSION}.`);
    break;
  }
  const reason = error.cause?.code ?? error.message;
  if (attempt === 1 || attempt % 10 === 0) log(`Waiting for MAAI or the internet (${reason})…`);
  await new Promise((r) => setTimeout(r, Math.min(30_000 * attempt, 5 * 60_000)));
}

// ---------- Updating itself ----------

/** Asks to be started again with the new copy (start.mjs does that). */
const UPDATED = 75;

/**
 * Takes the newest bot from MAAI when it differs from this one: written next to this file, checked to be
 * valid JavaScript, the old copy kept as bot.mjs.bak, then restarted. Any problem: keep running as is.
 */
let updating = false;
async function update() {
  if (updating) return;
  updating = true;
  try {
    await takeUpdate();
  } finally {
    updating = false;
  }
}
async function takeUpdate() {
  const { version, code } = await maai('GET', '/script');
  // Versions are dates ("2026-10-24e"): never go back to an older one.
  if (typeof version === 'string' && version < VERSION) return;
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
  // Swapped in one step (a rename), so a power cut never leaves half a file. Windows can refuse it for a moment
  // (an antivirus checking the new file): try a few times.
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(next, self);
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
  log(`Updated to ${version}. Restarting when the current commands are done…`);
  await whenIdle();
  await closeWhatsApp();
  process.exit(UPDATED);
}

await update().catch((error) => log('Could not check for an update:', why(error)));
setInterval(() => void update().catch((error) => log('Could not check for an update:', why(error))), 15 * 60_000);
closeLeftoverBrowser();
// If WhatsApp's browser dies (crash, killed), nothing else would notice: the bot would look alive and do nothing.
wa.once('ready', () => {
  wa.pupBrowser?.on('disconnected', () => {
    log('⚠ WhatsApp\'s browser closed. Starting again in 30 seconds…');
    process.exit(2);
  });
});
wa.initialize().catch((error) => {
  if (/Could not find Chrome|Failed to launch/i.test(error.message)) {
    fail('No browser for WhatsApp. Install Google Chrome (google.com/chrome), or put its path in .env as CHROME_PATH=C:\\...\\chrome.exe, then run npm start again.');
  }
  // Anything else (WhatsApp Web reloading while the bot connects: "Execution context was destroyed", a slow
  // page, a network blip) usually works on the next try: close the browser and let the watcher start again.
  log(`⚠ WhatsApp could not start (${why(error)}). Trying again in 30 seconds…`);
  void closeWhatsApp().finally(() => process.exit(2));
});
