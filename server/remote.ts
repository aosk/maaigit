import type { Lang } from '../shared/types.js';
import { answering, chat, currentConversation } from './ai/chat.js';
import { queueCommand, type Order } from './bot.js';
import { alertOrderCards } from './notify.js';
import { audit, save, state } from './store.js';

/**
 * Orders the user sends from their own second WhatsApp number (state.bot.orderPhone, set only in the signed-in
 * app). They go to the assistant exactly as if typed in the app, in the same conversation, and the answer goes
 * back to that number. The number is matched exactly, private chats only: a message from anyone else, a group,
 * or a forward in another chat is never an order. Anything that sends, books or changes something becomes an
 * approval card in MAAI, as in the app, so a lost phone can ask questions but cannot act.
 */

/** At most this many orders an hour (a lost phone, or a loop with another bot, cannot run up Claude). */
const PER_HOUR = 30;
/** Only orders this fresh are carried out: older ones (read again when the bot starts) are not. */
const FRESH_MS = 10 * 60_000;
/** How many handled order ids are remembered, so a message delivered twice is carried out once. */
const KEEP_IDS = 200;
/** Longest wait for an answer the app is writing in the same conversation. */
const WAIT_MS = 2 * 60_000;

const arabic = (text: string) => /[؀-ۿ]/.test(text);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const cards = answer.proposals.length;
    const waiting = !cards
      ? ''
      : lang === 'ar'
        ? `\n\n📝 ${cards === 1 ? 'بطاقة واحدة تنتظر' : `${cards} بطاقات تنتظر`} موافقتك في MAAI: ${answer.proposals.map((p) => p.title).join('، ')}. لا يُرسل أو يُنفّذ شيء حتى توافق من التطبيق.`
        : `\n\n📝 ${cards} card(s) waiting for your approval in MAAI: ${answer.proposals.map((p) => p.title).join(', ')}. Nothing is sent or done until you approve in the app.`;
    reply(`${answer.text}${waiting}`);
    if (cards) await alertOrderCards(cards);
  } catch (error) {
    reply(lang === 'ar' ? `ما قدرت أنفّذ الأمر: ${(error as Error).message}` : `Could not carry out the order: ${(error as Error).message}`);
  } finally {
    answering.delete(conversation.id);
    save();
  }
}
