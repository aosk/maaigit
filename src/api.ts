import type {
  AdminOverview,
  AppAlert,
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

  notify: () => call<NotifyStatus>('GET', '/notify'),
  setNotifyPrefs: (p: Partial<NotifyPrefs>) => call<NotifyPrefs>('PATCH', '/notify/prefs', p),
  subscribe: (subscription: PushSubscription, lang: Lang) => call<void>('POST', '/notify/subscribe', { subscription: subscription.toJSON(), lang }),
  unsubscribe: (endpoint: string) => call<void>('POST', '/notify/unsubscribe', { endpoint }),
  testNotify: (lang: Lang) => call<void>('POST', '/notify/test', { lang }),
  alerts: (since: string) => call<AppAlert[]>('GET', `/alerts?since=${encodeURIComponent(since)}`),

  admin: () => call<AdminOverview>('GET', '/admin'),
  setAgent: (id: AgentSetting['id'], enabled: boolean) => call<AgentSetting>('PATCH', `/admin/agents/${id}`, { enabled }),
};
