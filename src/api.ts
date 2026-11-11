import { confirmSession } from './inboxCache';
import type { AddressCard } from '../shared/vcard';
import type { AgentId, Decider, TradeLimits, TradeMode, TradingState } from '../shared/trading';
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/browser';
import type {
  AdminOverview,
  ProfileCategory,
  ProfileFact,
  ProfileInfo,
  UploadInfo,
  AgentSetting,
  AsanaControl,
  AsanaOverview,
  AsanaProject,
  AsanaTask,
  AppAlert,
  Briefing,
  BriefingFacts,
  ChatEvent,
  CalendarEvent,
  CloudUsage,
  RenderUsage,
  ApiKeyEntry,
  ApiKeyView,
  ChatTurn,
  InboxMessage,
  Lang,
  NewsDigest,
  NotifyPrefs,
  NotifyStatus,
  InboxFeed,
  HealthReport,
  ContactCount,
  ReplyMode,
  BotOverview,
  Proposal,
  Reminder,
  StatusInfo,
  StreamEvent,
  TodayData,
  Tone,
} from '../shared/types';

/** A new Asana task, as typed in a form. */
export interface NewAsanaTask {
  name: string;
  notes: string;
  dueOn: string;
  projectGid: string;
}

export const LOCKED_EVENT = 'maai:locked';

/** `background` marks the app's own automatic refreshes, which must not count as someone using it (see the Face ID lock). */
/** The host answers these while MAAI restarts after an update (about a minute). */
const RESTARTING = new Set([502, 503, 504]);

async function request(method: string, url: string, body?: unknown, background = false, signal?: AbortSignal): Promise<Response> {
  const send = () =>
    fetch(`/api${url}`, {
      method,
      signal,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(background ? { 'X-Maai-Background': '1' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let res = await send();
  // Reading is safe to repeat: while MAAI restarts, wait and try again (up to about 40 seconds) instead of showing an error.
  for (const wait of [3000, 7000, 12_000, 18_000]) {
    if (method !== 'GET' || !RESTARTING.has(res.status) || signal?.aborted) break;
    await new Promise((r) => setTimeout(r, wait));
    res = await send();
  }
  if (RESTARTING.has(res.status)) throw new Error(restartingMessage());
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; kind?: string; face?: boolean };
    // Not signed in yet: show the PIN or password screen instead of an error.
    if (res.status === 401 && data.error === 'locked') window.dispatchEvent(new CustomEvent(LOCKED_EVENT, { detail: { kind: data.kind, face: data.face === true } }));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return res;
}

/** In the app's language: MAAI is restarting (an update), not broken. */
const restartingMessage = () =>
  document.documentElement.lang === 'ar' ? '«معي» يُعاد تشغيله بعد تحديث. جرّب بعد دقيقة.' : 'MAAI is restarting after an update. Try again in a minute.';

/** Which «أسهمي» desk the trading calls work on: Tadawul, or the US (chosen on the screen). */
export type TradingMarket = 'sa' | 'us' | 'crypto';
let tradingMarket: TradingMarket = 'sa';
export const setTradingMarket = (m: TradingMarket) => {
  tradingMarket = m;
};
/** A trading address for a desk: the US desk's carry ?market=us. */
export const onMarket = (path: string, market: TradingMarket = tradingMarket) => (market === 'sa' ? path : `${path}${path.includes('?') ? '&' : '?'}market=${market}`);

async function call<T>(method: string, url: string, body?: unknown, background = false): Promise<T> {
  const res = await request(method, url, body, background);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** How long a reply may go without a single byte (the server sends a keep-alive every 15 s) before it is given up on. */
const IDLE_MS = 60_000;

/** Reads server-sent events ("data: {...}" blocks) and resolves with the final reply. */
async function readStream(res: Response, onEvent: (e: ChatEvent) => void, idleMs = IDLE_MS): Promise<{ reply: string; proposals: Proposal[] }> {
  if (!res.body) throw new Error('This browser cannot read live replies.');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  // A phone that went to sleep or lost signal leaves the socket half open: without this the screen would wait for ever.
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      void reader.cancel().catch(() => {});
    }, idleMs);
  };
  let buffer = '';
  try {
    arm();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      arm();
      buffer += value;
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const line = buffer.slice(0, cut).split('\n').find((l) => l.startsWith('data: '));
        buffer = buffer.slice(cut + 2);
        if (!line) continue;
        const event = JSON.parse(line.slice(6)) as StreamEvent;
        if (event.type === 'done') return { reply: event.reply, proposals: event.proposals };
        if (event.type === 'error') throw new Error(event.error);
        onEvent(event);
      }
    }
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
  throw new Error(
    stalled
      ? 'The connection stopped responding. Check your signal, then open the assistant again: the answer may already be there.'
      : 'The connection closed before MAAI finished. Try again.',
  );
}

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
}

export const api = {
  // /status sits behind the sign-in, so an answer proves the session is good: the saved Inbox may be shown.
  status: () => call<StatusInfo>('GET', '/status').then((s) => (confirmSession(), s)),
  unlock: (pin: string) => call<void>('POST', '/unlock', { pin }),
  logout: (everywhere = false) => call<void>('POST', '/logout', { everywhere }),
  setLockMinutes: (minutes: number) => call<{ minutes: number }>('PUT', '/security/lock', { minutes }),
  // Face ID: sign in without the password, and set it up or remove it once signed in.
  passkeyLoginOptions: () => call<PublicKeyCredentialRequestOptionsJSON>('POST', '/passkey/login/options', {}),
  passkeyLogin: (response: AuthenticationResponseJSON) => call<void>('POST', '/passkey/login', { response }),
  passkeys: () => call<Passkey[]>('GET', '/passkeys'),
  passkeyRegisterOptions: (password: string) => call<PublicKeyCredentialCreationOptionsJSON>('POST', '/passkeys/options', { password }),
  passkeyRegister: (response: RegistrationResponseJSON, name: string, password: string) => call<{ id: string }>('POST', '/passkeys', { response, name, password }),
  deletePasskey: (id: string) => call<void>('DELETE', `/passkeys/${encodeURIComponent(id)}`),
  today: (background = false) => call<TodayData>('GET', '/today', undefined, background),
  /** Tells the server someone is using MAAI, so the Face ID lock does not close it. */
  active: () => call<void>('POST', '/active', {}),
  briefing: (lang: Lang) => call<Briefing>('GET', `/briefing?lang=${lang}`),
  briefingFacts: (lang: Lang, background = false) => call<BriefingFacts>('GET', `/briefing/facts?lang=${lang}`, undefined, background),
  addEvent: (e: { title: string; start: string; minutes: number }) => call<CalendarEvent>('POST', '/events', e),
  reminderDone: (id: string) => call<Reminder>('POST', `/reminders/${id}/done`, { done: true }),

  chat: () => call<{ turns: ChatTurn[]; proposals: Proposal[] }>('GET', '/chat'),
  /** Uploads a photo or PDF for the assistant; answers with the id to attach to the next message. */
  upload: async (file: Blob, name: string): Promise<UploadInfo> => {
    const res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(name) }, body: file });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; kind?: string; face?: boolean };
      if (res.status === 401 && data.error === 'locked') window.dispatchEvent(new CustomEvent(LOCKED_EVENT, { detail: { kind: data.kind, face: data.face === true } }));
      throw new Error(data.error ?? `Upload failed (${res.status})`);
    }
    return (await res.json()) as UploadInfo;
  },
  /** Streams MAAI's progress (thinking, steps, reply text) and resolves with the final reply. `signal` abandons it (the screen was left). */
  send: async (text: string, lang: Lang, onEvent: (e: ChatEvent) => void, attachments: string[] = [], signal?: AbortSignal, voice?: Lang, spoken = false) =>
    readStream(await request('POST', '/chat/stream', { text, lang, attachments, voice, spoken }, false, signal), onEvent),
  /** Sends a recording to be turned into words (Arabic and English may be mixed). */
  contacts: () => call<ContactCount>('GET', '/contacts'),
  // StockSmart
  trading: (background = false, market?: TradingMarket) => call<TradingState>('GET', onMarket('/trading', market), undefined, background),
  tradingHalt: (reason?: string) => call<TradingState>('POST', onMarket('/trading/halt'), { reason }),
  tradingResume: () => call<TradingState>('POST', onMarket('/trading/resume'), {}),
  tradingCautionEnd: () => call<TradingState>('POST', onMarket('/trading/caution/end'), {}),
  tradingCautionAuto: (on: boolean) => call<TradingState>('PUT', onMarket('/trading/caution-auto'), { on }),
  tradingDecider: (decider: Decider) => call<TradingState>('PUT', onMarket('/trading/decider'), { decider }),
  tradingResolve: (orderId: string, executed: boolean) => call<TradingState>('POST', onMarket(`/trading/orders/${encodeURIComponent(orderId)}/resolve`), { executed }),
  tradingMode: (mode: TradeMode, confirm?: string) => call<TradingState>('POST', onMarket('/trading/mode'), { mode, confirm }),
  tradingLimits: (limits: Partial<TradeLimits>) => call<TradingState>('PUT', onMarket('/trading/limits'), limits),
  tradingDirective: (text: string) => call<TradingState>('POST', onMarket('/trading/directives'), { text }),
  tradingRemoveDirective: (id: string) => call<TradingState>('DELETE', onMarket(`/trading/directives/${id}`)),
  tradingExcluded: (excluded: string[]) => call<TradingState>('PUT', onMarket('/trading/excluded'), { excluded }),
  tradingAgent: (id: AgentId, enabled: boolean) => call<TradingState>('POST', onMarket(`/trading/agents/${id}`), { enabled }),
  tradingAsk: (question: string, lang: Lang) => call<{ answer: string }>('POST', onMarket('/trading/ask'), { question, lang }),
  tradingRound: () => call<TradingState>('POST', onMarket('/trading/round'), {}),
  tradingReplay: () => call<TradingState>('POST', onMarket('/trading/replay'), {}),
  tradingReview: () => call<TradingState>('POST', onMarket('/trading/review'), {}),
  tradingShariahCheck: () => call<TradingState>('POST', onMarket('/trading/shariah/check'), {}),
  tradingBotKey: () => call<{ key: string; signSecret: string }>('POST', onMarket('/trading/bot/key'), {}),
  tradingRevokeBot: () => call<TradingState>('DELETE', onMarket('/trading/bot/key')),
  /** The cards were read from the file in the browser; only names, numbers, emails and companies are sent. */
  importContacts: async (cards: AddressCard[]): Promise<ContactCount> => {
    const res = await fetch('/api/contacts/import', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(cards) });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; kind?: string; face?: boolean };
      if (res.status === 401 && data.error === 'locked') window.dispatchEvent(new CustomEvent(LOCKED_EVENT, { detail: { kind: data.kind, face: data.face === true } }));
      throw new Error(data.error ?? `Import failed (${res.status})`);
    }
    return (await res.json()) as ContactCount;
  },
  clearContacts: () => call<ContactCount>('DELETE', '/contacts'),
  profile: () => call<ProfileInfo>('GET', '/profile'),
  addFact: (text: string, category: ProfileCategory) => call<ProfileFact>('POST', '/profile/facts', { text, category }),
  updateFact: (id: string, change: { text?: string; category?: ProfileCategory; pinned?: boolean }) => call<ProfileFact>('PATCH', `/profile/facts/${id}`, change),
  deleteFact: (id: string) => call<void>('DELETE', `/profile/facts/${id}`),
  useProfile: (enabled: boolean) => call<ProfileInfo>('PUT', '/profile/enabled', { enabled }),
  forgetProfile: () => call<void>('DELETE', '/profile'),
  approveRemember: (id: string, fact: { text: string; category: ProfileCategory }) => call<Proposal>('POST', `/proposals/${id}/approve`, fact),
  resetChat: () => call<void>('POST', '/chat/reset'),
  approveDevice: (id: string, task: string) => call<Proposal>('POST', `/proposals/${id}/approve`, { task }),
  approve: (id: string, start?: string) => call<Proposal>('POST', `/proposals/${id}/approve`, { start }),
  approveEmail: (id: string, mail: { to: string; subject: string; body: string }) => call<Proposal>('POST', `/proposals/${id}/approve`, mail),
  approveWhatsApp: (id: string, body: string) => call<Proposal>('POST', `/proposals/${id}/approve`, { body }),
  approveAsana: (id: string, change: { comment: string; complete: boolean; dueOn: string }) => call<Proposal>('POST', `/proposals/${id}/approve`, change),
  cancel: (id: string) => call<Proposal>('POST', `/proposals/${id}/cancel`, {}),

  inbox: () => call<InboxMessage[]>('GET', '/inbox'),
  addMessage: (m: { from: string; phone?: string; email?: string; text: string }) => call<InboxMessage>('POST', '/inbox', m),
  emailReply: (id: string, mail: { to: string; subject: string; body: string }) => call<InboxMessage>('POST', `/inbox/${id}/email`, mail),
  draft: (id: string, tone: Tone, lang: Lang) => call<{ draft: string; summary: string }>('POST', `/inbox/${id}/draft`, { tone, lang }),
  inboxFeed: (lang: Lang, refresh = false, background = false) => call<InboxFeed>('GET', `/inbox/feed?lang=${lang}${refresh ? '&refresh=1' : ''}`, undefined, background),
  labelFeedItem: (key: string, needsReply: 'yes' | 'no' | null) => call<void>('POST', '/inbox/feed/label', { key, needsReply }),
  sendWhatsApp: (id: string, body: string) => call<InboxMessage>('POST', `/inbox/${id}/whatsapp`, { body }),
  replied: (id: string) => call<InboxMessage>('POST', `/inbox/${id}/replied`, {}),
  deleteMessage: (id: string) => call<void>('DELETE', `/inbox/${id}`),

  calendarFeed: () => call<{ https: string; webcal: string }>('GET', '/calendar/feed'),
  /** Re-reads calendars, Asana and Gmail on the server now. */
  sync: () => call<{ at: string; problems: string[] }>('POST', '/sync'),
  asana: () => call<AsanaOverview>('GET', '/asana'),
  asanaCheck: () => call<{ user: string; email?: string; workspaces: { name: string; open: number }[]; shown: number; cachedAt?: string; error?: string }>('GET', '/asana/check'),
  asanaProjects: () => call<AsanaProject[]>('GET', '/asana/projects'),
  asanaCreate: (task: NewAsanaTask) => call<AsanaTask>('POST', '/asana/tasks', task),
  asanaComplete: (gid: string, done: boolean) => call<void>('POST', `/asana/tasks/${gid}/complete`, { done }),
  asanaSetDue: (gid: string, dueOn: string) => call<void>('POST', `/asana/tasks/${gid}/due`, { dueOn }),
  asanaControls: (gid: string) => call<AsanaControl[]>('GET', `/asana/tasks/${gid}/controls`),
  asanaSetStatus: (gid: string, change: { type: AsanaControl['type']; optionGid: string; fieldGid?: string }) => call<void>('POST', `/asana/tasks/${gid}/status`, change),
  approveAsanaNew: (id: string, task: NewAsanaTask) => call<Proposal>('POST', `/proposals/${id}/approve`, task),
  mailCount: () => call<{ unread: number | null; total?: number }>('GET', '/mail/count', undefined, true),
  news: (lang: Lang) => call<NewsDigest>('GET', `/news?lang=${lang}`),
  refreshNews: (lang: Lang) => call<NewsDigest>('POST', '/news/refresh', { lang }),
  notify: () => call<NotifyStatus>('GET', '/notify'),
  setNotifyPrefs: (p: Partial<NotifyPrefs>) => call<NotifyPrefs>('PATCH', '/notify/prefs', p),
  subscribe: (subscription: PushSubscription, lang: Lang) => call<void>('POST', '/notify/subscribe', { subscription: subscription.toJSON(), lang }),
  unsubscribe: (endpoint: string) => call<void>('POST', '/notify/unsubscribe', { endpoint }),
  testNotify: () => call<void>('POST', '/notify/test'),
  sendBriefing: () => call<void>('POST', '/notify/briefing'),
  alerts: (since: string) => call<AppAlert[]>('GET', `/alerts?since=${encodeURIComponent(since)}`, undefined, true),

  adminCloud: (refresh = false) => call<CloudUsage>('GET', `/admin/cloud${refresh ? '?refresh=1' : ''}`),
  adminKeys: () => call<ApiKeyView[]>('GET', '/admin/keys'),
  adminAddKey: (entry: Partial<ApiKeyEntry>) => call<ApiKeyView[]>('POST', '/admin/keys', entry),
  adminUpdateKey: (id: string, change: Partial<ApiKeyEntry> & { renewed?: boolean }) => call<ApiKeyView[]>('PUT', `/admin/keys/${encodeURIComponent(id)}`, change),
  adminRemoveKey: (id: string) => call<ApiKeyView[]>('DELETE', `/admin/keys/${encodeURIComponent(id)}`),
  adminRender: (refresh = false) => call<RenderUsage>('GET', `/admin/render${refresh ? '?refresh=1' : ''}`),
  admin: (background = false) => call<AdminOverview>('GET', '/admin', undefined, background),
  setAgent: (id: AgentSetting['id'], enabled: boolean) => call<AgentSetting>('PATCH', `/admin/agents/${id}`, { enabled }),
  health: (background = false) => call<HealthReport>('GET', '/admin/health', undefined, background),
  bot: (background = false) => call<BotOverview>('GET', '/admin/bot', undefined, background),
  botKey: () => call<BotOverview & { key: string }>('POST', '/admin/bot/key', {}),
  botDisconnect: () => call<BotOverview>('DELETE', '/admin/bot/key'),
  setReplyMode: (mode: ReplyMode) => call<BotOverview>('PATCH', '/admin/bot/mode', { mode }),
  restartBot: () => call<BotOverview>('POST', '/admin/bot/restart', {}),
  setOrderPhone: (phone: string) => call<BotOverview>('PUT', '/admin/bot/order-phone', { phone }),
  lockOrders: () => call<BotOverview>('POST', '/admin/bot/order-lock', {}),
  setOrderPin: (pin: string) => call<BotOverview>('PUT', '/admin/bot/order-pin', { pin }),
};
