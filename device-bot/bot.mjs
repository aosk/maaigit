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

const wa = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(HERE, '.wwebjs_auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox'] },
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

wa.on('qr', (qr) => {
  console.log('\nOpen WhatsApp on the phone → Linked devices → Link a device, and scan this:\n');
  qrcode.generate(qr, { small: true });
});
wa.on('authenticated', () => log('WhatsApp linked.'));
wa.on('auth_failure', (m) => fail(`WhatsApp sign-in failed: ${m}. Delete the .wwebjs_auth folder and scan again.`));
wa.on('disconnected', (why) => fail(`WhatsApp disconnected (${why}). Start the bot again and scan the QR.`));

// Every message in every chat, including the user's own (those only tell MAAI the chat is answered).
wa.on('message_create', async (msg) => {
  try {
    if (msg.isStatus || msg.from === 'status@broadcast' || msg.broadcast) return;
    const chat = await msg.getChat();
    const group = chat.isGroup;
    let phone = '';
    let from = '';
    if (msg.fromMe) {
      if (group) return;
      phone = digits(chat.id?._serialized?.endsWith('@c.us') ? chat.id._serialized : (await chat.getContact?.())?.number);
    } else {
      const contact = await msg.getContact();
      phone = digits(contact.number || (group ? msg.author : msg.from));
      from = contact.pushname || contact.name || '';
      if (group) from = `${from || `+${phone}`} · ${chat.name}`;
    }
    const media = msg.hasMedia || ['ptt', 'audio', 'image', 'video', 'document', 'sticker'].includes(msg.type);
    queue.push({
      id: msg.id._serialized,
      channel: 'whatsapp',
      from: from || undefined,
      phone: phone || undefined,
      text: (msg.body ?? '').slice(0, 4000),
      media: media || undefined,
      at: new Date((msg.timestamp ?? Date.now() / 1000) * 1000).toISOString(),
      group: group || undefined,
      fromMe: msg.fromMe || undefined,
    });
    keepQueue();
  } catch (error) {
    log('Could not read a message:', error.message);
  }
});

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
        await wa.sendMessage(`${c.phone}@c.us`, c.text);
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

let syncing = false;
async function sync() {
  if (syncing) return;
  syncing = true;
  try {
    do {
      const batch = queue.slice(0, 200);
      const out = await maai('POST', '/sync', { device: DEVICE, messages: batch });
      queue = queue.slice(batch.length);
      keepQueue();
      log(`Delivered ${out.stored} new message(s); ${out.noted} fixed note(s) to send.`);
      await handle(out.commands);
    } while (queue.length);
  } catch (error) {
    log('Delivery failed, trying again later:', error.message);
  } finally {
    syncing = false;
  }
}

wa.on('ready', async () => {
  log('WhatsApp ready. Connecting to MAAI…');
  await sync();
  setInterval(sync, SYNC_MS);
  setInterval(() => maai('GET', `/commands?device=${encodeURIComponent(DEVICE)}`).then((r) => handle(r.commands)).catch((e) => log(e.message)), 60_000);
  log(`Running: messages go to MAAI every ${SYNC_MS / 60_000} minutes, commands are checked every minute. Leave this window open.`);
});

process.on('SIGINT', async () => {
  log('Stopping…');
  await wa.destroy().catch(() => {});
  process.exit(0);
});

await maai('GET', '/status')
  .then(() => log('MAAI reachable, key accepted.'))
  .catch((error) => fail(`Could not reach MAAI at ${BASE} (${error.cause?.code ?? error.message}). Check MAAI_URL and the internet connection.`));
wa.initialize();
