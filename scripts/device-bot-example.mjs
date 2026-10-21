// An outline of a device bot for MAAI (see docs/device-bot.md). Fill in the three functions marked
// "YOUR BOT" with your own WhatsApp reader and sender (or your Grok bot), then run:
//   MAAI_URL=https://your-maai.onrender.com MAAI_BOT_KEY=maai_... node scripts/device-bot-example.mjs

const BASE = `${(process.env.MAAI_URL ?? '').replace(/\/$/, '')}/bot/v1`;
const KEY = process.env.MAAI_BOT_KEY ?? '';
if (!BASE.startsWith('https://') && !BASE.startsWith('http://localhost')) throw new Error('Set MAAI_URL to your MAAI address (https).');
if (!KEY.startsWith('maai_')) throw new Error('Set MAAI_BOT_KEY to the device key from the admin page.');

const DEVICE = 'My device bot';
/** Only these task words are carried out; everything else is refused. */
const ALLOWED_TASKS = [/^open\b/i, /^remind\b/i];

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ---------- YOUR BOT ----------

/** Messages since `since` (WhatsApp and email), in the shape docs/device-bot.md describes. */
async function readNewMessages(since) {
  void since;
  return [];
}

/** Sends one WhatsApp message from your number. Throw if it fails. */
async function sendWhatsApp(phone, text) {
  console.log(`[would send to +${phone}] ${text}`);
}

/** Carries out one approved task. Return a short result. */
async function runTask(text) {
  return `Done: ${text}`;
}

// ---------- The loop ----------

async function handle(commands) {
  for (const c of commands) {
    try {
      if (c.kind === 'reply') {
        await sendWhatsApp(c.phone, c.text);
        await call('POST', `/commands/${c.id}/result`, { ok: true });
      } else if (ALLOWED_TASKS.some((rule) => rule.test(c.text))) {
        await call('POST', `/commands/${c.id}/result`, { ok: true, output: String(await runTask(c.text)).slice(0, 4000) });
      } else {
        await call('POST', `/commands/${c.id}/result`, { ok: false, output: 'Not on this device\'s list of allowed tasks.' });
      }
    } catch (error) {
      await call('POST', `/commands/${c.id}/result`, { ok: false, output: String(error.message).slice(0, 500) }).catch(() => {});
    }
  }
}

let since = new Date(Date.now() - 3_600_000);
async function sync() {
  const messages = await readNewMessages(since);
  since = new Date();
  for (let i = 0; i < messages.length || i === 0; i += 200) {
    const out = await call('POST', '/sync', { device: DEVICE, messages: messages.slice(i, i + 200) });
    console.log(`Delivered ${out.stored} new, ${out.repeats} repeats; ${out.noted} fixed notes queued.`);
    await handle(out.commands);
  }
}

const safely = (fn) => () => fn().catch((error) => console.error(error.message));
await safely(sync)();
setInterval(safely(sync), 60 * 60_000);
setInterval(safely(async () => handle((await call('GET', `/commands?device=${encodeURIComponent(DEVICE)}`)).commands)), 60_000);
