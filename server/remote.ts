import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Lang, Proposal } from '../shared/types.js';
import { answering, chat, currentConversation } from './ai/chat.js';
import { approveCard, cancelCard } from './approve.js';
import { BotInputError, queueCommand, type Order } from './bot.js';
import { alertOrderCards, alertWhatsAppApproval } from './notify.js';
import { config } from './config.js';
import { sttConfigured, transcribe } from './stt.js';
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

/**
 * Gives each card made from an order a short number to approve it by, with its full description. A card whose
 * description does not fit in the WhatsApp answer is listed by title only, and can be approved in the app only.
 */
function number(cards: Proposal[], lang: Lang, now: number): string[] {
  const list = (state.bot.orderCards ?? []).filter((c) => now - Date.parse(c.at) < 24 * 3_600_000);
  let room = ROOM_FOR_CARDS;
  const shown = cards.map((card) => {
    state.bot.cardNo = ((state.bot.cardNo ?? 0) % 999) + 1;
    const no = state.bot.cardNo;
    const full = `#${no} ${describe(card, lang)}`;
    const fits = full.length <= room;
    if (fits) room -= full.length;
    list.push({ no, id: card.id, at: new Date(now).toISOString(), ...(fits ? {} : { appOnly: true }) });
    return fits ? full : `#${no} ${card.title} (${lang === 'ar' ? 'طويلة: وافق عليها من التطبيق' : 'too long to show here: approve it in the app'})`;
  });
  state.bot.orderCards = list.slice(-50);
  return shown;
}

/**
 * Everything a card will do, in full, so approving it from WhatsApp approves exactly what was read: the real
 * address or number (never only the name Claude gave it) and the whole text. Approval carries out the card as
 * it is, so nothing it does may be left out or shortened here.
 */
function describe(p: Proposal, lang: Lang): string {
  const when = (iso: string) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', { timeZone: config.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const ar = lang === 'ar';
  switch (p.kind) {
    case 'email': return `✉️ ${ar ? 'إيميل إلى' : 'Email to'} ${p.toName ? `${p.toName} <${p.to}>` : p.to}\n${ar ? 'الموضوع' : 'Subject'}: ${p.subject}\n${p.body}`;
    case 'whatsapp': return `💬 ${ar ? 'واتساب إلى' : 'WhatsApp to'} ${p.toName} (+${p.phone})\n${p.body}`;
    case 'meeting': return `📅 ${p.title}${p.attendeeEmail ? ` · ${p.attendeeEmail}` : ''}${p.options[0] ? ` · ${when(p.options[0].start)} (${p.minutes} ${ar ? 'دقيقة' : 'min'})` : ''}${p.options.length > 1 ? (ar ? ' (الخيار الأول)' : ' (first option)') : ''}`;
    case 'reminder': return `⏰ ${p.title} · ${p.when}`;
    case 'asana': return `✅ ${p.taskName}${p.comment ? `\n${ar ? 'تعليق' : 'Comment'}: ${p.comment}` : ''}${p.complete ? (ar ? '\n(إنهاء المهمة)' : '\n(mark done)') : ''}${p.dueOn ? `\n${ar ? 'الموعد' : 'Due'}: ${p.dueOn}` : ''}`;
    case 'asana_new': return `➕ ${p.title}${p.notes ? `\n${p.notes}` : ''}${p.dueOn ? `\n${ar ? 'الموعد' : 'Due'}: ${p.dueOn}` : ''}${p.projectGid ? `\n${ar ? 'المشروع' : 'Project'}: ${p.projectGid}` : ''}`;
    case 'remember': return `🧠 ${p.title}`;
    case 'device': return `🖥️ ${p.title}`;
  }
}

/** Room in one WhatsApp answer for the cards' full descriptions (the rest is the assistant's words and the how-to). */
const ROOM_FOR_CARDS = 3000;

// ---------- Approving from WhatsApp ----------

// Only these words decide a card: a casual 'yes 2' or 'لا 3' (an answer to a question) stays an order.
const APPROVE = /^(?:approve|موافق|وافق|اعتمد)\s*#?\s*(\d{1,3})(?:\s+(\S+))?\s*$/i;
/** An approval word and a card number ("موافق 3 …"): never passed to the assistant, even when the rest is not understood. */
const LOOKS_LIKE_APPROVAL = /^(?:approve|موافق|وافق|اعتمد)\s*#?\s*\d/i;

/**
 * Arabic keyboards type ٠١٢٣ (and Persian ones ۰۱۲۳): read them as 0123, and drop the invisible direction
 * marks phones add around numbers, so "موافق ١ ١٢٣٤٥٦" is read the same as "approve 1 123456".
 */
const plainDigits = (text: string) =>
  text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();

/** Whether the message holds the PIN anywhere (then it is never passed to the assistant). */
// A few numbers at most: each check is a deliberately slow hash, and a long text must not stall the server.
const holdsPin = (text: string) => (text.match(/\d{6,8}/g) ?? []).slice(0, 5).some(pinMatches);
const CANCEL = /^(?:cancel|الغ|الغي|إلغاء|الغاء)\s*#?\s*(\d{1,3})\s*$/i;

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
  if (entry.appOnly) return ar ? `البطاقة #${no} طويلة ولم تُعرض كاملة هنا: وافق عليها من التطبيق.` : `Card #${no} was too long to show in full here: approve it in the app.`;
  if (APP_ONLY.includes(card.kind)) return ar ? `البطاقة #${no} تعمل على جهازك، ووافق عليها من التطبيق فقط.` : `Card #${no} acts on your computer: approve it in the app.`;
  if (now - Date.parse(entry.at) > CARD_FRESH_MS) return ar ? `البطاقة #${no} قديمة (أكثر من ٣٠ دقيقة). وافق عليها من التطبيق.` : `Card #${no} is over 30 minutes old. Approve it in the app.`;
  try {
    // Carried out exactly as shown in full when it was made: the card's own content, nothing changed.
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
  // Its clock starts when it runs: an order can wait behind others for a while.
  queue = queue.then(() => carryOut(order, Date.now())).catch((error: Error) => console.error('Order failed:', error.message));
}

async function carryOut(order: Order, now: number): Promise<void> {
  const phone = state.bot.orderPhone;
  if (!phone) return;
  let lang: Lang = arabic(order.text) ? 'ar' : 'en';
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

  let text = order.text.trim();
  // A voice note is written out first (Arabic and English in one sentence), and the user sees what was heard.
  if (order.audio) {
    if (!sttConfigured) {
      reply('للأوامر الصوتية أحتاج خدمة تحويل الصوت لنص: أضف STT_API_KEY في Render. أو اكتب الأمر نصاً.\nVoice orders need STT_API_KEY on Render. Or type the order.');
      return;
    }
    try {
      text = (await transcribe(order.audio)).trim();
    } catch (error) {
      reply(`ما قدرت أسمع الرسالة الصوتية (${(error as Error).message}). أرسلها مرة ثانية أو اكتبها.`);
      return;
    }
    lang = arabic(text) ? 'ar' : 'en';
    if (!text) {
      reply(lang === 'ar' ? 'ما سمعت كلاماً في الرسالة الصوتية.' : 'I heard no words in that voice note.');
      return;
    }
    // Approving needs the PIN, and a PIN is never spoken: approvals and cancels are typed.
    const plainVoice = plainDigits(text);
    if (APPROVE.test(plainVoice) || CANCEL.test(plainVoice) || LOOKS_LIKE_APPROVAL.test(plainVoice) || holdsPin(plainVoice)) {
      reply(lang === 'ar' ? 'الموافقة والإلغاء بالكتابة فقط، لا تقل رمزك بصوت. اكتب: موافق <الرقم> <رمزك>' : 'Approve or cancel by typing only, never say your PIN aloud. Type: approve <number> <your PIN>');
      return;
    }
    audit('Voice order from your WhatsApp number', 'You (WhatsApp)', 'done');
    reply(`🎙️ ${lang === 'ar' ? 'سمعت' : 'Heard'}: «${text.slice(0, 500)}»`);
  }
  if (!text) {
    reply(lang === 'ar' ? 'أقرأ الرسائل النصية والصوتية فقط. اكتب الأمر أو سجّله.' : 'I read text and voice notes only. Type or record the order.');
    return;
  }

  // "approve 3 123456" / "cancel 3" never go to the assistant: the PIN stays out of Claude and the history.
  const plain = plainDigits(text);
  const decided = await approval(plain, lang, now).finally(save);
  if (decided) {
    reply(decided);
    return;
  }
  // An approval MAAI could not read, or anything with the PIN in it, stays out of the assistant too.
  if (LOOKS_LIKE_APPROVAL.test(plain) || holdsPin(plain)) {
    reply(lang === 'ar' ? 'ما فهمت الموافقة. اكتبها هكذا: موافق 3 ثم رمزك (مثال: موافق 3 123456).' : 'I could not read that approval. Write it like: approve 3 and your PIN (for example: approve 3 123456).');
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
    const cards = number(answer.proposals, lang, now);
    const ar = lang === 'ar';
    const how = state.bot.orderPin
      ? ar ? 'للموافقة أرسل: موافق <الرقم> <رمزك> · للإلغاء: الغ <الرقم> · أو من التطبيق.' : 'To approve, send: approve <number> <your PIN> · to cancel: cancel <number> · or use the app.'
      : ar ? 'وافق من تطبيق MAAI (أو عيّن رمز PIN في الإدارة لتوافق من هنا).' : 'Approve in the MAAI app (or set a PIN in Admin to approve from here).';
    const waiting = cards.length ? `\n\n📝 ${ar ? 'بانتظار موافقتك:' : 'Waiting for your approval:'}\n${cards.join('\n\n')}\n\n${how}` : '';
    reply(`${answer.text}${waiting}`);
    if (cards.length) await alertOrderCards(cards.length);
  } catch (error) {
    reply(lang === 'ar' ? `ما قدرت أنفّذ الأمر: ${(error as Error).message}` : `Could not carry out the order: ${(error as Error).message}`);
  } finally {
    answering.delete(conversation.id);
    save();
  }
}
