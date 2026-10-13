import type {
  AdminOverview,
  AgentSetting,
  AsanaOverview,
  AppAlert,
  Briefing,
  ChatEvent,
  CalendarEvent,
  ChatTurn,
  InboxMessage,
  Lang,
  MailDigest,
  NotifyPrefs,
  NotifyStatus,
  Proposal,
  Reminder,
  StatusInfo,
  StreamEvent,
  TodayData,
  Tone,
} from '../shared/types';

export const LOCKED_EVENT = 'maai:locked';

async function request(method: string, url: string, body?: unknown): Promise<Response> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; kind?: string };
    // Not signed in yet: show the PIN or password screen instead of an error.
    if (res.status === 401 && data.error === 'locked') window.dispatchEvent(new CustomEvent(LOCKED_EVENT, { detail: data.kind }));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return res;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await request(method, url, body);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Reads server-sent events ("data: {...}" blocks) and resolves with the final reply. */
async function readStream(res: Response, onEvent: (e: ChatEvent) => void): Promise<{ reply: string; proposals: Proposal[] }> {
  if (!res.body) throw new Error('This browser cannot read live replies.');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
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
  throw new Error('The connection closed before MAAI finished. Try again.');
}

export const api = {
  status: () => call<StatusInfo>('GET', '/status'),
  unlock: (pin: string) => call<void>('POST', '/unlock', { pin }),
  logout: () => call<void>('POST', '/logout'),
  today: () => call<TodayData>('GET', '/today'),
  briefing: (lang: Lang) => call<Briefing>('GET', `/briefing?lang=${lang}`),
  addEvent: (e: { title: string; start: string; minutes: number }) => call<CalendarEvent>('POST', '/events', e),
  reminderDone: (id: string) => call<Reminder>('POST', `/reminders/${id}/done`, { done: true }),

  chat: () => call<{ turns: ChatTurn[]; proposals: Proposal[] }>('GET', '/chat'),
  /** Streams MAAI's progress (thinking, steps, reply text) and resolves with the final reply. */
  send: async (text: string, lang: Lang, onEvent: (e: ChatEvent) => void) => readStream(await request('POST', '/chat/stream', { text, lang }), onEvent),
  resetChat: () => call<void>('POST', '/chat/reset'),
  approve: (id: string, start?: string) => call<Proposal>('POST', `/proposals/${id}/approve`, { start }),
  approveEmail: (id: string, mail: { to: string; subject: string; body: string }) => call<Proposal>('POST', `/proposals/${id}/approve`, mail),
  approveAsana: (id: string, change: { comment: string; complete: boolean; dueOn: string }) => call<Proposal>('POST', `/proposals/${id}/approve`, change),
  cancel: (id: string) => call<Proposal>('POST', `/proposals/${id}/cancel`, {}),

  inbox: () => call<InboxMessage[]>('GET', '/inbox'),
  addMessage: (m: { from: string; phone?: string; email?: string; text: string }) => call<InboxMessage>('POST', '/inbox', m),
  emailReply: (id: string, mail: { to: string; subject: string; body: string }) => call<InboxMessage>('POST', `/inbox/${id}/email`, mail),
  draft: (id: string, tone: Tone, lang: Lang) => call<{ draft: string; summary: string }>('POST', `/inbox/${id}/draft`, { tone, lang }),
  replied: (id: string) => call<InboxMessage>('POST', `/inbox/${id}/replied`, {}),
  deleteMessage: (id: string) => call<void>('DELETE', `/inbox/${id}`),

  calendarFeed: () => call<{ https: string; webcal: string }>('GET', '/calendar/feed'),
  asana: () => call<AsanaOverview>('GET', '/asana'),
  mailCount: () => call<{ unread: number | null; total?: number }>('GET', '/mail/count'),
  mailDigest: (lang: Lang, refresh = false) => call<MailDigest>('GET', `/mail/digest?lang=${lang}${refresh ? '&refresh=1' : ''}`),
  notify: () => call<NotifyStatus>('GET', '/notify'),
  setNotifyPrefs: (p: Partial<NotifyPrefs>) => call<NotifyPrefs>('PATCH', '/notify/prefs', p),
  subscribe: (subscription: PushSubscription, lang: Lang) => call<void>('POST', '/notify/subscribe', { subscription: subscription.toJSON(), lang }),
  unsubscribe: (endpoint: string) => call<void>('POST', '/notify/unsubscribe', { endpoint }),
  testNotify: () => call<void>('POST', '/notify/test'),
  alerts: (since: string) => call<AppAlert[]>('GET', `/alerts?since=${encodeURIComponent(since)}`),

  admin: () => call<AdminOverview>('GET', '/admin'),
  setAgent: (id: AgentSetting['id'], enabled: boolean) => call<AgentSetting>('PATCH', `/admin/agents/${id}`, { enabled }),
};
