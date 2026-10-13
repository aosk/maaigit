import type {
  AdminOverview,
  AppAlert,
  MailDigest,
  NotifyPrefs,
  NotifyStatus,
  AgentSetting,
  Briefing,
  CalendarEvent,
  ChatTurn,
  InboxMessage,
  Lang,
  Proposal,
  Reminder,
  StatusInfo,
  Tone,
} from '../shared/types';
import type { PrayerName } from '../shared/prayer';

export interface TodayData {
  events: CalendarEvent[];
  reminders: Reminder[];
  prayers: { name: PrayerName; time: string }[];
  nextPrayer: { name: PrayerName; time: string };
}

export const LOCKED_EVENT = 'maai:locked';

export type StreamEvent =
  | { type: 'thinking'; text: string }
  | { type: 'step'; tool: string; detail?: string }
  | { type: 'text'; text: string }
  | { type: 'done'; reply: string; proposals: Proposal[] }
  | { type: 'error'; error: string };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; kind?: string };
    // On a phone without the PIN yet: show the PIN screen instead of an error.
    if (res.status === 401 && data.error === 'locked') window.dispatchEvent(new CustomEvent(LOCKED_EVENT, { detail: data.kind }));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
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
  sendStream: async (text: string, lang: Lang, onEvent: (e: StreamEvent) => void): Promise<{ reply: string; proposals: Proposal[] }> => {
    const res = await fetch('/api/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }) });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; kind?: string };
      if (res.status === 401 && data.error === 'locked') window.dispatchEvent(new CustomEvent(LOCKED_EVENT, { detail: data.kind }));
      throw new Error(data.error ?? `Request failed (${res.status})`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let cut;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const event = JSON.parse(line.slice(6)) as StreamEvent;
        if (event.type === 'done') return { reply: event.reply, proposals: event.proposals };
        if (event.type === 'error') throw new Error(event.error);
        onEvent(event);
      }
    }
    throw new Error('The connection closed before MAAI finished. Try again.');
  },
  send: (text: string, lang: Lang) => call<{ reply: string; proposals: Proposal[] }>('POST', '/chat', { text, lang }),
  resetChat: () => call<void>('POST', '/chat/reset'),
  approve: (id: string, start?: string) => call<Proposal>('POST', `/proposals/${id}/approve`, { start }),
  approveEmail: (id: string, mail: { to: string; subject: string; body: string }) => call<Proposal>('POST', `/proposals/${id}/approve`, mail),
  cancel: (id: string) => call<Proposal>('POST', `/proposals/${id}/cancel`, {}),

  inbox: () => call<InboxMessage[]>('GET', '/inbox'),
  addMessage: (m: { from: string; phone?: string; email?: string; text: string }) => call<InboxMessage>('POST', '/inbox', m),
  emailReply: (id: string, mail: { to: string; subject: string; body: string }) => call<InboxMessage>('POST', `/inbox/${id}/email`, mail),
  draft: (id: string, tone: Tone, lang: Lang) => call<{ draft: string; summary: string }>('POST', `/inbox/${id}/draft`, { tone, lang }),
  replied: (id: string) => call<InboxMessage>('POST', `/inbox/${id}/replied`, {}),
  deleteMessage: (id: string) => call<void>('DELETE', `/inbox/${id}`),

  mailCount: () => call<{ unread: number | null; total?: number }>('GET', '/mail/count'),
  mailDigest: (lang: Lang, refresh = false) => call<MailDigest>('GET', `/mail/digest?lang=${lang}${refresh ? '&refresh=1' : ''}`),
  notify: () => call<NotifyStatus>('GET', '/notify'),
  setNotifyPrefs: (p: Partial<NotifyPrefs>) => call<NotifyPrefs>('PATCH', '/notify/prefs', p),
  subscribe: (subscription: PushSubscription, lang: Lang) => call<void>('POST', '/notify/subscribe', { subscription: subscription.toJSON(), lang }),
  unsubscribe: (endpoint: string) => call<void>('POST', '/notify/unsubscribe', { endpoint }),
  testNotify: (lang: Lang) => call<void>('POST', '/notify/test', { lang }),
  alerts: (since: string) => call<AppAlert[]>('GET', `/alerts?since=${encodeURIComponent(since)}`),

  admin: () => call<AdminOverview>('GET', '/admin'),
  setAgent: (id: AgentSetting['id'], enabled: boolean) => call<AgentSetting>('PATCH', `/admin/agents/${id}`, { enabled }),
};
