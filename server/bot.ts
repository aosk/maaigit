import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { BotCommand, BotStatus, DeviceAction, InboxMessage } from '../shared/types.js';
import { config } from './config.js';
import { isEmail } from './mail.js';
import { phoneDigits } from '../shared/vcard.js';
import { agentEnabled, audit, id, save, state } from './store.js';
import { answer, tell, whyNot } from './intake.js';

/**
 * The user's own device bot (for example a Grok bot on their computer or phone). It connects to MAAI,
 * never the other way round: every hour it delivers the WhatsApp and email it read, and every minute or so
 * it asks for commands. It proves itself with a device key that only its hash is kept of. MAAI sends it
 * only two things: the fixed WhatsApp note (once per person per 6 hours) and what the user approved.
 */

/** Delivered messages kept, newest first. */
const MAX_MESSAGES = 1000;
/** Most messages in one delivery. */
export const MAX_BATCH = 200;
/** Commands kept in the history (waiting ones are always kept). */
const MAX_COMMANDS = 200;
/** A command the bot has not picked up in this long is dropped: a reply a day late is worse than none. */
const COMMAND_TTL_MS = 24 * 3_600_000;
/** Only messages this recent are answered or alerted, so reading older chats does not answer weeks of messages. */
const ACK_RECENT_MS = 30 * 60_000;
/** Connected but silent longer than this: the Inbox says the bot looks stopped. */
const STALE_MS = 2 * 3_600_000;

// ---------- The device key ----------

const hash = (key: string) => createHash('sha256').update(key).digest();

/** Makes a new key (the old one stops working). The key is shown once; only its hash is kept. */
export function createKey(): string {
  const key = `maai_${randomBytes(32).toString('base64url')}`;
  state.bot.keyHash = hash(key).toString('hex');
  state.bot.keyHint = key.slice(0, 9);
  audit('New device bot key made (the previous one no longer works)', 'Admin', 'done');
  save();
  return key;
}

/** Disconnects the bot: its key stops working and nothing waiting is sent. */
export function revokeKey(): void {
  state.bot.keyHash = undefined;
  state.bot.keyHint = undefined;
  for (const c of state.bot.commands) if (c.status === 'queued') c.status = 'expired';
  audit('Device bot disconnected', 'Admin', 'done');
  save();
}

export function keyMatches(given: string): boolean {
  if (!state.bot.keyHash || !given) return false;
  const expected = Buffer.from(state.bot.keyHash, 'hex');
  const actual = hash(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const botConnected = () => Boolean(state.bot.keyHash);

export function botStatus(now = Date.now()): BotStatus {
  const { keyHash, keyHint, device, lastSeen, lastSync } = state.bot;
  const connected = Boolean(keyHash);
  return {
    connected,
    keyHint: connected ? keyHint : undefined,
    device,
    lastSeen,
    lastSync,
    stale: connected && (!lastSeen || now - Date.parse(lastSeen) > STALE_MS),
    waiting: state.bot.commands.filter((c) => c.status === 'queued').length,
    messages: state.inbox.filter((m) => m.via === 'bot').length,
    replyMode: state.replyMode,
    contacts: state.contacts.length,
    orderPhone: state.bot.orderPhone,
    orderPin: Boolean(state.bot.orderPin),
    ...(linkNeeded(now) ? { link: { ...(link!.code ? { code: link!.code } : { qr: true }), at: new Date(link!.at).toISOString() } } : {}),
  };
}

// ---------- Linking WhatsApp ----------

/** WhatsApp gives a new code every 3 minutes; an old one is not shown. */
const LINK_FRESH_MS = 4 * 60_000;
/**
 * The code that links WhatsApp on the device, while it waits. Kept in memory only (never saved or logged):
 * whoever has it can link the user's WhatsApp, so it goes no further than the signed-in app.
 */
let link: { code?: string; at: number } | null = null;
const linkNeeded = (now: number) => Boolean(link && now - link.at < LINK_FRESH_MS);

/**
 * The bot says WhatsApp needs linking ({"code": "ABCD1234"} or {"qr": true}), or is linked again ({"linked": true}).
 * The first time in a while it is needed, the user's phones are told, without the code (it would show on the lock screen).
 */
export function receiveLink(body: unknown, tell: () => Promise<void>, now = Date.now()): void {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.linked === true) {
    link = null;
    return;
  }
  const code = str(b.code, 20).replace(/[\s-]/g, '').toUpperCase();
  if (code && !/^[A-Z0-9]{8}$/.test(code)) throw new BotInputError('The code is 8 letters or digits.');
  if (!code && b.qr !== true && typeof b.lost !== 'string') throw new BotInputError('Send {"code": "..."}, {"qr": true} or {"linked": true}.');
  if (typeof b.lost === 'string' && !code) {
    console.log(`Device bot: WhatsApp disconnected (${str(b.lost, 60)})`);
    return;
  }
  const fresh = !linkNeeded(now);
  link = { ...(code ? { code } : {}), at: now };
  if (fresh) void tell().catch((error: Error) => console.error('Link alert failed:', error.message));
}

/** Forgets the code (tests only). */
export function resetLink(): void {
  link = null;
}

export function seen(device?: string, now = Date.now()): void {
  state.bot.lastSeen = new Date(now).toISOString();
  if (device) state.bot.device = device;
  save();
}

// ---------- Messages the bot delivers ----------

export class BotInputError extends Error {}

const str = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const digits = (value: unknown) => str(value, 40).replace(/\D/g, '');

interface Incoming {
  externalId: string;
  channel: 'whatsapp' | 'email';
  from: string;
  phone?: string;
  email?: string;
  subject?: string;
  text: string;
  at: number;
  group: boolean;
  fromMe: boolean;
  /** Sent by the bot itself (MAAI's replies): neither kept nor taken as the user answering. */
  byMaai: boolean;
  /** A photo, voice note or file (its text is only a caption, if any). */
  media: boolean;
}

/** One delivered message, checked field by field; null for something that cannot be used. */
/** Why delivered messages could not be used, counted for the server log. */
type Unusable = 'not an object' | 'no id' | 'no channel' | 'no text';

/** A field as text: numbers are accepted too, since some WhatsApp Web versions give ids as numbers. */
const field = (value: unknown, max: number) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : str(value, max));

function parse(raw: unknown, now: number, why?: (reason: Unusable) => void): Incoming | null {
  if (!raw || typeof raw !== 'object') return why?.('not an object'), null;
  const m = raw as Record<string, unknown>;
  const externalId = field(m.id, 128);
  const channel = m.channel === 'email' ? 'email' : m.channel === 'whatsapp' ? 'whatsapp' : null;
  if (!externalId) return why?.('no id'), null;
  if (!channel) return why?.('no channel'), null;
  const phone = digits(m.phone);
  const email = str(m.email, 320);
  const media = m.media === true;
  const text = field(m.text, 4000) || (media ? '[A photo, voice note or file: MAAI cannot read these]' : '');
  if (!text) return why?.('no text'), null;
  const at = Date.parse(str(m.at, 40));
  return {
    externalId: `bot:${externalId}`,
    channel,
    from: str(m.from, 100) || (phone ? `+${phone}` : email || 'Unknown'),
    phone: phone.length >= 5 && phone.length <= 20 ? phone : undefined,
    email: email && isEmail(email) ? email : undefined,
    subject: channel === 'email' ? str(m.subject, 300) || undefined : undefined,
    text,
    // A time in the future (a wrong device clock) counts as now.
    at: Number.isFinite(at) ? Math.min(at, now) : now,
    group: m.group === true,
    fromMe: m.fromMe === true,
    byMaai: m.byMaai === true,
    media,
  };
}

export interface Delivery {
  stored: number;
  repeats: number;
  skipped: number;
  /** People MAAI is answering by itself. */
  noted: number;
  /** The user's own messages (they only mark chats as answered). */
  own: number;
  /** Orders from the user's order number (handed to the assistant, not kept in the Inbox). */
  orders: number;
}

/** A message from the user's own order number: an instruction for the assistant, not a message to answer. */
export interface Order {
  externalId: string;
  text: string;
  at: number;
  /** A voice note (its recording), written out before it is carried out. */
  audio?: Buffer;
}

/** The user's order number (digits, international form), set in the admin page; empty to stop taking orders. */
export function setOrderPhone(value: unknown): void {
  const phone = typeof value === 'string' ? phoneDigits(value) : '';
  if (phone && (phone.length < 8 || phone.length > 15)) throw new BotInputError('Give the full number with the country code, for example 9665XXXXXXXX.');
  state.bot.orderPhone = phone || undefined;
  state.bot.orders = [];
  save();
}

/** Keeps what the bot delivered, marks chats the user already answered on the phone, and queues the fixed note. */
export function receiveFromBot(body: unknown, now = Date.now(), onOrder: (order: Order) => void = () => {}): Delivery {
  const list = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(list)) throw new BotInputError('Send {"messages": [...]}.');
  if (list.length > MAX_BATCH) throw new BotInputError(`At most ${MAX_BATCH} messages at a time.`);

  const known = new Set(state.inbox.map((m) => m.externalId).filter(Boolean));
  const reasons: Partial<Record<Unusable, number>> = {};
  const parsed = list.map((raw) => parse(raw, now, (reason) => (reasons[reason] = (reasons[reason] ?? 0) + 1)));
  const result: Delivery = { stored: 0, repeats: 0, skipped: parsed.filter((m) => !m).length, noted: 0, own: 0, orders: 0 };
  const incoming = parsed.filter((m): m is Incoming => m !== null).sort((a, b) => a.at - b.at);

  // The user's own messages are not kept; they only show which chats are already answered.
  const answeredAt = new Map<string, number>();
  for (const m of incoming) if (m.fromMe && !m.byMaai && m.phone) answeredAt.set(m.phone, Math.max(m.at, answeredAt.get(m.phone) ?? 0));
  for (const m of state.inbox) {
    const answered = m.phone ? answeredAt.get(m.phone) : undefined;
    if (answered && Date.parse(m.receivedAt) <= answered) m.replied = true;
  }

  const fresh: InboxMessage[] = [];
  for (const m of incoming) {
    if (m.fromMe) {
      result.own += 1;
      continue;
    }
    // Only a private message from exactly the order number is an order. It never reaches the Inbox or the
    // automatic replies; the assistant takes it (each message once, and only while fresh: see server/remote.ts).
    if (m.channel === 'whatsapp' && !m.group && m.phone && m.phone === state.bot.orderPhone) {
      result.orders += 1;
      onOrder({ externalId: m.externalId, text: m.media && m.text.startsWith('[A photo') ? '' : m.text, at: m.at });
      continue;
    }
    if (known.has(m.externalId)) {
      result.repeats += 1;
      continue;
    }
    known.add(m.externalId);
    const answered = m.phone ? (answeredAt.get(m.phone) ?? 0) >= m.at : false;
    const message: InboxMessage = {
      id: id(),
      from: m.from,
      phone: m.phone,
      email: m.email,
      subject: m.subject,
      channel: m.channel,
      text: m.text,
      receivedAt: new Date(m.at).toISOString(),
      replied: answered,
      via: 'bot',
      group: m.group || undefined,
      externalId: m.externalId,
    };
    state.inbox.push(message);
    fresh.push(message);
    result.stored += 1;
  }

  // The newest message from each person gets MAAI's first reply (written in the background) and an alert.
  const newest = new Map<string, InboxMessage>();
  for (const message of fresh) if (message.channel === 'whatsapp' && !message.group && message.phone) newest.set(message.phone, message);
  const notAnswered: Record<string, number> = {};
  for (const message of newest.values()) {
    const reason = whyNot(message, now);
    if (reason) notAnswered[reason] = (notAnswered[reason] ?? 0) + 1;
    if (now - Date.parse(message.receivedAt) > ACK_RECENT_MS || message.replied) continue;
    void tell(message, {}, now);
    if (reason) continue;
    result.noted += 1;
    void answer(message, (text) => queueCommand({ kind: 'reply', phone: message.phone, toName: message.from, text, automatic: true })).catch((error: Error) => console.error('First reply failed:', error.message));
  }

  pruneBotMessages(now);
  state.bot.lastSync = new Date(now).toISOString();
  // Counts only (never names or text), so a delivery that keeps nothing can be explained from the server log.
  const version = str((body as { version?: unknown }).version, 40);
  if (version) state.bot.version = version;
  console.log(`Device bot${version ? ` ${version}` : ''} delivered ${list.length}: ${result.stored} new, ${result.repeats} repeats, ${result.own} own${result.orders ? `, ${result.orders} order(s)` : ''}, ${result.skipped} unusable${result.skipped ? ` (${Object.entries(reasons).map(([r, n]) => `${r}: ${n}`).join(', ')})` : ''}, ${result.noted} to answer${Object.keys(notAnswered).length ? ` (not answered: ${Object.entries(notAnswered).map(([r, n]) => `${r} ×${n}`).join('; ')})` : ''}`);
  save();
  return result;
}

/** Old delivered messages go after the days the user chose, and never more than MAX_MESSAGES are kept. */
export function pruneBotMessages(now = Date.now()): void {
  const oldest = now - config.whatsappDays * 86_400_000;
  state.inbox = state.inbox.filter((m) => m.via !== 'bot' || Date.parse(m.receivedAt) >= oldest);
  const delivered = state.inbox.filter((m) => m.via === 'bot').sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  if (delivered.length > MAX_MESSAGES) {
    const drop = new Set(delivered.slice(0, delivered.length - MAX_MESSAGES));
    state.inbox = state.inbox.filter((m) => !drop.has(m));
  }
}

/** The user can answer this message from their own number through the bot (WhatsApp, one person, not a group). */
export const canSendByBot = (m: InboxMessage | undefined): boolean => Boolean(m && m.via === 'bot' && m.channel === 'whatsapp' && !m.group && m.phone && botConnected());

/** The latest WhatsApp the bot delivered from this number, if the user can answer it through the bot. */
export function botReplyTarget(phone: string): InboxMessage | undefined {
  const latest = state.inbox.filter((m) => m.via === 'bot' && m.channel === 'whatsapp' && m.phone === phone && !m.group).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  return canSendByBot(latest) ? latest : undefined;
}

// ---------- Commands ----------

/** Tells a bot that is waiting for commands that one is ready (see waitForCommands). */
const queuedSignal = new EventEmitter();
queuedSignal.setMaxListeners(20);

/**
 * Commands for the bot, waiting up to `ms` for one to be queued if there are none yet, so a reply MAAI writes
 * reaches the bot the moment it is ready instead of at the bot's next check. `onGone` registers a callback for
 * when the bot hangs up: then nothing is taken, so no command is marked sent without reaching it.
 */
export function waitForCommands(ms: number, onGone: (gone: () => void) => void): Promise<ReturnType<typeof takeCommands>> {
  const ready = takeCommands();
  if (ready.length || ms <= 0) return Promise.resolve(ready);
  return new Promise((resolve) => {
    let done = false;
    const finish = (take: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      queuedSignal.off('queued', onQueued);
      resolve(take ? takeCommands() : []);
    };
    const onQueued = () => finish(true);
    const timer = setTimeout(onQueued, ms);
    queuedSignal.on('queued', onQueued);
    onGone(() => finish(false));
  });
}

export const DEVICE_ACTIONS: readonly DeviceAction[] = ['open_url', 'open_path', 'send_file'];

/**
 * The link or file an action works on, cleaned, or a BotInputError saying what is wrong. Links are web pages
 * only (no file:, javascript: or app links, no passwords in them). A file is a name or a path: the bot itself
 * only opens or sends files inside the folders the user allowed on the device, and never runs a program.
 */
export function deviceTarget(action: DeviceAction, value: unknown): string {
  const target = str(value, 2000).replace(/\p{Cc}/gu, '');
  if (!target) throw new BotInputError(action === 'open_url' ? 'Give the link to open.' : 'Give the file or folder name.');
  if (action === 'open_url') {
    let url: URL;
    try {
      // "example.com/page" is a web page; "file:", "javascript:" and app links keep their scheme, and are refused below.
      url = new URL(/^[a-z][\w+.-]*:(?:\/\/|(?!\d))/i.test(target) ? target : `https://${target}`);
    } catch {
      throw new BotInputError('That is not a web link.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BotInputError('Only web links (https://…) can be opened.');
    if (url.username || url.password) throw new BotInputError('Links with a password in them are not opened.');
    return url.href;
  }
  if (target.length > 300) throw new BotInputError('Keep the file name or path under 300 characters.');
  return target;
}

export function queueCommand(command: Pick<BotCommand, 'kind' | 'text' | 'phone' | 'toName' | 'automatic' | 'action'>, now = Date.now()): BotCommand {
  if (!botConnected()) throw new BotInputError('The device bot is not connected. Make a device key in the admin page first.');
  const queued: BotCommand = { id: id(), ...command, status: 'queued', createdAt: new Date(now).toISOString() };
  state.bot.commands.push(queued);
  queuedSignal.emit('queued');
  const finished = state.bot.commands.filter((c) => c.status !== 'queued');
  if (finished.length > MAX_COMMANDS) {
    const drop = new Set(finished.slice(0, finished.length - MAX_COMMANDS));
    state.bot.commands = state.bot.commands.filter((c) => !drop.has(c));
  }
  save();
  return queued;
}

/** What the bot gets: each waiting command, once. A command handed over is never handed over again, so nothing is sent twice. */
export function takeCommands(now = Date.now()): Pick<BotCommand, 'id' | 'kind' | 'phone' | 'toName' | 'text' | 'action'>[] {
  const out: Pick<BotCommand, 'id' | 'kind' | 'phone' | 'toName' | 'text' | 'action'>[] = [];
  for (const c of state.bot.commands) {
    if (c.status !== 'queued') continue;
    if (now - Date.parse(c.createdAt) > COMMAND_TTL_MS) {
      c.status = 'expired';
      continue;
    }
    // A switch turned off after a command was queued still stops it.
    if ((c.kind === 'reply' && !agentEnabled('messaging')) || (c.kind === 'task' && !agentEnabled('device'))) {
      c.status = 'expired';
      continue;
    }
    c.status = 'sent';
    c.sentAt = new Date(now).toISOString();
    out.push({ id: c.id, kind: c.kind, phone: c.phone, toName: c.toName, text: c.text, ...(c.action ? { action: c.action } : {}) });
  }
  if (out.length) save();
  return out;
}

export function finishCommand(commandId: string, body: unknown, now = Date.now()): BotCommand | null {
  const c = state.bot.commands.find((x) => x.id === commandId);
  if (!c) return null;
  if (c.status !== 'sent') throw new BotInputError(`This command is ${c.status}, not waiting for a result.`);
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.ok !== 'boolean') throw new BotInputError('Send {"ok": true or false, "output": "..."}.');
  c.status = b.ok ? 'done' : 'failed';
  c.finishedAt = new Date(now).toISOString();
  c.result = str(b.output, 4000) || undefined;
  // Why something failed goes to the server log too (the bot's own error words: no message text is in them).
  if (!b.ok) console.log(`Device bot could not do ${c.kind}${c.action ? ` ${c.action}` : ''}${c.automatic ? ' (automatic)' : ''}: ${(c.result ?? 'no reason given').slice(0, 200)}`);
  if (!c.automatic) audit(`Device bot ${b.ok ? 'did' : 'could not do'}: ${c.kind === 'reply' ? `the WhatsApp reply to ${c.toName ?? c.phone}` : c.text.slice(0, 80)}`, 'Device bot', b.ok ? 'done' : 'error');
  save();
  return c;
}

/** The device bot's recent task results, newest first, for the assistant. */
export function recentResults(now = Date.now(), within = 24 * 3_600_000): BotCommand[] {
  return state.bot.commands
    .filter((c) => c.kind === 'task' && c.finishedAt && now - Date.parse(c.finishedAt) < within)
    .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
    .slice(0, 5);
}

// ---------- Contacts ----------

/** Most contacts kept. */
const MAX_CONTACTS = 5000;

/** Replaces the saved contacts with what the bot sent: names and numbers only. */
export function receiveContacts(body: unknown): number {
  const list = (body as { contacts?: unknown } | null)?.contacts;
  if (!Array.isArray(list)) throw new BotInputError('Send {"contacts": [{"name": "...", "phone": "9665..."}]}.');
  if (list.length > MAX_CONTACTS) throw new BotInputError(`At most ${MAX_CONTACTS} contacts.`);
  const seen = new Set<string>();
  const contacts: { name: string; phone: string }[] = [];
  for (const raw of list) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const name = str(c.name, 80).replace(/\p{Cc}|[<>]/gu, '');
    const phone = digits(c.phone);
    if (!name || phone.length < 8 || phone.length > 15 || seen.has(phone)) continue;
    seen.add(phone);
    contacts.push({ name, phone });
  }
  state.contacts = contacts;
  save();
  console.log(`Device bot sent ${contacts.length} contacts`);
  return contacts.length;
}
