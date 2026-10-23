import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Lang, Proposal } from '../shared/types.js';
import { answering, chat, currentConversation } from './ai/chat.js';
import { approveCard, cancelCard } from './approve.js';
import { BotInputError, queueCommand, type Order } from './bot.js';
import { alertOrderCards, alertWhatsAppApproval } from './notify.js';
import { config } from './config.js';
import { audit, save, state } from './store.js';

/**
 * Orders the user sends from their own second WhatsApp number (state.bot.orderPhone, set only in the signed-in
 * app). They go to the assistant exactly as if typed in the app, in the same conversation, and the answer goes
 * back to that number. The number is matched exactly, private chats only: a message from anyone else, a group,
 * or a forward in another chat is never an order.
 *
 * Anything that sends, books or changes something becomes an approval card, as in the app. With a PIN set (in
 * the app), a card can also be approved from that number: "approve 3 123456". The approval message is handled
 * here, before the assistant, so the PIN never reaches Claude or the conversation. Wrong PINs lock WhatsApp
 * approval for an hour, every approval is logged as made from WhatsApp, and the user's phones are told.
 */

/** At most this many orders an hour (a lost phone, or a loop with another bot, cannot run up Claude). */
const PER_HOUR = 30;
/** Only orders this fresh are carried out: older ones (read again when the bot starts) are not. */
const FRESH_MS = 10 * 60_000;
/** How many handled order ids are remembered, so a message delivered twice is carried out once. */
const KEEP_IDS = 200;
/** Longest wait for an answer the app is writing in the same conversation. */
const WAIT_MS = 2 * 60_000;
/** A card can be approved from WhatsApp only this long after it was made. */
const CARD_FRESH_MS = 30 * 60_000;
/** Wrong PINs allowed before WhatsApp approval is locked, and for how long. */
const MAX_WRONG = 3;
const LOCK_MS = 60 * 60_000;
/** Cards that can only be approved in the app: they act on the user's work computer. */
const APP_ONLY: Proposal['kind'][] = ['device'];

const arabic = (text: string) => /[؀-ۿ]/.test(text);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- The PIN ----------

const hashPin = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('hex');

/** Sets the PIN for approving from WhatsApp (6 to 8 digits), or removes it (""). Only its salted hash is kept. */
export function setOrderPin(value: unknown): void {
  const pin = typeof value === 'string' ? value.trim() : '';
  if (pin && !/^\d{6,8}$/.test(pin)) throw new BotInputError('The PIN is 6 to 8 digits.');
  if (pin && /^(\d)\1+$/.test(pin)) throw new BotInputError('Choose a PIN that is not one digit repeated.');
  if (pin) {
    const salt = randomBytes(16).toString('hex');
    state.bot.orderPin = { salt, hash: hashPin(pin, salt) };
  } else {
    delete state.bot.orderPin;
  }
  delete state.bot.pinFails;
  save();
}

function pinMatches(pin: string): boolean {
  const saved = state.bot.orderPin;
  if (!saved) return false;
  const given = Buffer.from(hashPin(pin, saved.salt), 'hex');
  const expected = Buffer.from(saved.hash, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ---------- Numbered cards ----------

/** Gives each card made from an order a short number to approve it by. */
function number(cards: Proposal[], now: number): { no: number; card: Proposal }[] {
  const list = (state.bot.orderCards ?? []).filter((c) => now - Date.parse(c.at) < 24 * 3_600_000);
  const out = cards.map((card) => {
    state.bot.cardNo = ((state.bot.cardNo ?? 0) % 999) + 1;
    list.push({ no: state.bot.cardNo, id: card.id, at: new Date(now).toISOString() });
    return { no: state.bot.cardNo, card };
  });
  state.bot.orderCards = list.slice(-50);
  return out;
}

/** What a card will do, in one line, so it can be approved without opening the app. */
function describe(p: Proposal, lang: Lang): string {
  const cut = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const when = (iso: string) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', { timeZone: config.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  switch (p.kind) {
    case 'email': return `✉️ ${p.toName ?? p.to}: ${cut(p.subject)}\n${cut(p.body, 300)}`;
    case 'whatsapp': return `💬 ${p.toName}: ${cut(p.body, 300)}`;
    case 'meeting': return `📅 ${p.title}${p.options[0] ? ` · ${when(p.options[0].start)}` : ''}${p.options.length > 1 ? (lang === 'ar' ? ' (الخيار الأول)' : ' (first option)') : ''}`;
    case 'reminder': return `⏰ ${p.title} · ${p.when}`;
    case 'asana': return `✅ ${p.taskName}${p.comment ? `: ${cut(p.comment)}` : ''}${p.complete ? (lang === 'ar' ? ' (إنهاء)' : ' (mark done)') : ''}${p.dueOn ? ` · ${p.dueOn}` : ''}`;
    case 'asana_new': return `➕ ${p.title}${p.dueOn ? ` · ${p.dueOn}` : ''}`;
    case 'remember': return `🧠 ${cut(p.title)}`;
    case 'device': return `🖥️ ${p.title}`;
  }
}

// ---------- Approving from WhatsApp ----------

const APPROVE = /^(?:approve|ok|yes|موافق|وافق|اعتمد|نعم)\s*#?\s*(\d{1,3})(?:\s+(\S+))?\s*$/i;
const CANCEL = /^(?:cancel|no|الغ|الغي|إلغاء|الغاء|لا)\s*#?\s*(\d{1,3})\s*$/i;

/** Handles "approve 3 123456" and "cancel 3". Returns the answer, or null when the message is not one of those. */
async function approval(text: string, lang: Lang, now: number): Promise<string | null> {
  const ar = lang === 'ar';
  const approve = APPROVE.exec(text);
  const cancel = approve ? null : CANCEL.exec(text);
  if (!approve && !cancel) return null;
  const no = Number((approve ?? cancel)![1]);
  const entry = (state.bot.orderCards ?? []).find((c) => c.no === no);
  const card = entry && state.proposals.find((p) => p.id === entry.id);
  if (!card) return ar ? `ما فيه بطاقة رقم ${no}.` : `There is no card #${no}.`;
  if (card.status !== 'pending') return ar ? `البطاقة #${no} ${card.status === 'approved' ? 'تمت الموافقة عليها' : 'ملغاة'} من قبل.` : `Card #${no} is already ${card.status}.`;

  if (cancel) {
    cancelCard(card, 'You (WhatsApp)');
    return ar ? `ألغيت البطاقة #${no}.` : `Cancelled card #${no}.`;
  }

  if (!state.bot.orderPin) return ar ? 'الموافقة من الواتساب تحتاج رمز PIN: عيّنه في MAAI ← الإدارة ← بوت الجهاز. أو وافق من التطبيق.' : 'Approving from WhatsApp needs a PIN: set it in MAAI → Admin → Device bot. Or approve in the app.';
  const fails = state.bot.pinFails;
  if (fails && fails.count >= MAX_WRONG && now - Date.parse(fails.since) < LOCK_MS) {
    return ar ? 'الموافقة من الواتساب مقفلة ساعة بسبب رمز خاطئ. وافق من التطبيق.' : 'Approving from WhatsApp is locked for an hour after wrong PINs. Approve in the app.';
  }
  const pin = approve![2];
  if (!pin) return ar ? `أرسل: موافق ${no} ثم رمزك` : `Send: approve ${no} and your PIN`;
  if (!pinMatches(pin)) {
    const fresh = !fails || now - Date.parse(fails.since) >= LOCK_MS;
    state.bot.pinFails = { count: fresh ? 1 : fails.count + 1, since: fresh ? new Date(now).toISOString() : fails.since };
    const left = MAX_WRONG - state.bot.pinFails.count;
    audit(`Wrong PIN from WhatsApp for card #${no}`, 'WhatsApp order number', 'error');
    if (left <= 0) {
      audit('WhatsApp approval locked for an hour after wrong PINs', 'WhatsApp order number', 'error');
      void alertWhatsAppApproval(ar ? 'رمز خاطئ ٣ مرات: أُقفلت الموافقة من الواتساب ساعة' : '3 wrong PINs: approving from WhatsApp is locked for an hour').catch(() => {});
      return ar ? 'رمز خاطئ. أُقفلت الموافقة من الواتساب ساعة.' : 'Wrong PIN. Approving from WhatsApp is now locked for an hour.';
    }
    return ar ? `رمز خاطئ. باقي ${left} محاولة.` : `Wrong PIN. ${left} tries left.`;
  }
  delete state.bot.pinFails;
  if (APP_ONLY.includes(card.kind)) return ar ? `البطاقة #${no} تعمل على جهازك، ووافق عليها من التطبيق فقط.` : `Card #${no} acts on your computer: approve it in the app.`;
  if (now - Date.parse(entry.at) > CARD_FRESH_MS) return ar ? `البطاقة #${no} قديمة (أكثر من ٣٠ دقيقة). وافق عليها من التطبيق.` : `Card #${no} is over 30 minutes old. Approve it in the app.`;
  try {
    // Approved exactly as shown: the card's own content, with nothing changed.
    const done = await approveCard(card, { ...card }, 'You (WhatsApp, with PIN)');
    void alertWhatsAppApproval(done).catch(() => {});
    return `✅ ${done}`;
  } catch (error) {
    return ar ? `ما تمت: ${(error as Error).message}` : `Not done: ${(error as Error).message}`;
  }
}

// ---------- Orders ----------

/** Orders run one after another, in the order they were sent. */
let queue: Promise<void> = Promise.resolve();

/** Takes one order (already checked to come from the order number) and answers it on WhatsApp. */
export function takeOrder(order: Order, now = Date.now()): void {
  const done = state.bot.orders ?? (state.bot.orders = []);
  if (done.includes(order.externalId) || now - order.at > FRESH_MS) return;
  done.push(order.externalId);
  if (done.length > KEEP_IDS) done.splice(0, done.length - KEEP_IDS);
  save();
  queue = queue.then(() => carryOut(order, now)).catch((error: Error) => console.error('Order failed:', error.message));
}

async function carryOut(order: Order, now: number): Promise<void> {
  const phone = state.bot.orderPhone;
  if (!phone) return;
  const lang: Lang = arabic(order.text) ? 'ar' : 'en';
  const reply = (text: string) => queueCommand({ kind: 'reply', phone, toName: 'MAAI', text: `🤖 MAAI\n${text}`.slice(0, 4000), automatic: true });

  const hourAgo = new Date(now - 3_600_000).toISOString();
  const recent = (state.bot.orderTimes ?? []).filter((t) => t > hourAgo);
  if (recent.length >= PER_HOUR) {
    // Said once, when the limit is reached; then quiet until the hour passes.
    if (recent.length === PER_HOUR) reply(lang === 'ar' ? `وصلت الحد (${PER_HOUR} أمر في الساعة). جرّب بعد قليل.` : `That is ${PER_HOUR} orders this hour, the limit. Try again a little later.`);
    state.bot.orderTimes = [...recent, new Date(now).toISOString()];
    return;
  }
  state.bot.orderTimes = [...recent, new Date(now).toISOString()];

  const text = order.text.trim();
  if (!text) {
    reply(lang === 'ar' ? 'أقرأ الرسائل النصية فقط. اكتب الأمر نصاً.' : 'I read text only. Type the order as a message.');
    return;
  }

  // "approve 3 123456" / "cancel 3" never go to the assistant: the PIN stays out of Claude and the history.
  const decided = await approval(text, lang, now).finally(save);
  if (decided) {
    reply(decided);
    return;
  }

  const conversation = currentConversation();
  for (const start = Date.now(); answering.has(conversation.id) && Date.now() - start < WAIT_MS; ) await pause(1000);
  if (answering.has(conversation.id)) {
    reply(lang === 'ar' ? 'المساعد مشغول بالرد في التطبيق. أرسل الأمر مرة ثانية بعد دقيقة.' : 'MAAI is busy answering in the app. Send the order again in a minute.');
    return;
  }
  answering.add(conversation.id);
  try {
    audit('Order from your WhatsApp number', 'You (WhatsApp)', 'done');
    const answer = await chat(conversation, `(from my WhatsApp) ${text.slice(0, 4000)}`, lang);
    const cards = number(answer.proposals, now);
    const ar = lang === 'ar';
    const how = state.bot.orderPin
      ? ar ? 'للموافقة أرسل: موافق <الرقم> <رمزك> · للإلغاء: الغ <الرقم> · أو من التطبيق.' : 'To approve, send: approve <number> <your PIN> · to cancel: cancel <number> · or use the app.'
      : ar ? 'وافق من تطبيق MAAI (أو عيّن رمز PIN في الإدارة لتوافق من هنا).' : 'Approve in the MAAI app (or set a PIN in Admin to approve from here).';
    const waiting = cards.length ? `\n\n📝 ${ar ? 'بانتظار موافقتك:' : 'Waiting for your approval:'}\n${cards.map(({ no, card }) => `#${no} ${describe(card, lang)}`).join('\n\n')}\n\n${how}` : '';
    reply(`${answer.text}${waiting}`);
    if (cards.length) await alertOrderCards(cards.length);
  } catch (error) {
    reply(lang === 'ar' ? `ما قدرت أنفّذ الأمر: ${(error as Error).message}` : `Could not carry out the order: ${(error as Error).message}`);
  } finally {
    answering.delete(conversation.id);
    save();
  }
}
