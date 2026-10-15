import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writePrivate } from './secure-fs.js';
import type Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { calendarConfigured, googleEvents } from './gcal.js';
import { dedupeEvents } from '../shared/schedule.js';
import type {
  AgentSetting,
  AppAlert,
  AuditEntry,
  CalendarEvent,
  UsageRow,
  ChatTurn,
  InboxMessage,
  Lang,
  NotifyPrefs,
  ProfileFact,
  Proposal,
  Reminder,
} from '../shared/types.js';

export interface Conversation {
  id: string;
  /** Exactly what was sent to and received from Claude, appended to and never edited. */
  apiMessages: Anthropic.Beta.Messages.BetaMessageParam[];
  /** What the app shows. */
  turns: ChatTurn[];
}

interface State {
  events: CalendarEvent[];
  reminders: Reminder[];
  inbox: InboxMessage[];
  proposals: Proposal[];
  conversations: Conversation[];
  audit: AuditEntry[];
  agents: AgentSetting[];
  drafts: number;
  usage: { inputTokens: number; outputTokens: number; requests: number };
  /** The latest headlines read from the trusted news sources (public titles and links only). */
  news: { fetchedAt?: string; items: import('../shared/types.js').NewsRaw[]; sources: import('../shared/types.js').NewsDigest['sources'] };
  /** Face ID / fingerprint keys that can sign in without the password (the public half only). */
  passkeys: { id: string; publicKey: string; counter: number; transports?: string[]; name: string; createdAt: string; lastUsedAt?: string }[];
  /** The highest day-load score reached on each day (kept 30 days), for the trend. */
  stressDays: Record<string, number>;
  /** Inbox emails the user dealt with through MAAI (a reply sent or a meeting booked), by email number. */
  handledMail: Record<string, { how: 'replied' | 'meeting'; at: string }>;
  /** Claude's last answer for each kind of summary, with the data it was based on. */
  aiCache: Record<string, { fingerprint: string; at: string; value: unknown }>;
  /** Token use per day and feature (kept 90 days). */
  usageLog: UsageRow[];
  /** Phones and browsers that turned on notifications. */
  subscriptions: { subscription: { endpoint: string; keys: { p256dh: string; auth: string } }; lang: Lang; createdAt: string }[];
  notifyPrefs: NotifyPrefs;
  /** Keys of alerts already sent, so each goes out once. */
  sentAlerts: string[];
  /** Recent alerts, for the banner in the open app. */
  alerts: AppAlert[];
  /** When each WhatsApp number was last sent the automatic "received" note. */
  whatsappAcks: Record<string, string>;
  /** What MAAI knows about the user: short facts the user wrote or approved. */
  profile: { enabled: boolean; facts: ProfileFact[] };
}

export const DEFAULT_PREFS: NotifyPrefs = { reminders: true, leave: true, events: false, eventMinutes: 10, prayers: false, prayerMinutes: 10, briefing: false, briefingTime: '07:00' };

const DATA_FILE = process.env.MAAI_DATA_FILE ?? path.join(config.dataDir, 'store.json');

export const id = () => randomUUID().slice(0, 8);

function at(dayOffset: number, hour: number, minute: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** A believable first day, so every screen has something on it. */
function seed(): State {
  return {
    events: [
      { id: id(), title: 'Team stand-up', start: at(0, 9, 0), minutes: 15, place: 'Microsoft Teams' , demo: true },
      { id: id(), title: 'Call with Sara', start: at(0, 11, 30), minutes: 30, place: 'Phone', bookedByMaai: true , demo: true },
      { id: id(), title: 'Dentist appointment', start: at(0, 16, 0), minutes: 45, place: 'Clinic', travelMinutes: 18 , demo: true },
      { id: id(), title: 'Q4 report review', start: at(1, 10, 0), minutes: 60, place: 'Office' , demo: true },
    ],
    reminders: [
      { id: id(), title: 'Pay the electricity bill', when: 'Today, 20:00', at: at(0, 20, 0), repeat: 'once', done: false },
      { id: id(), title: 'Call my mother', when: 'Every day, 15 min after Maghrib', prayer: 'maghrib', offsetMinutes: 15, repeat: 'daily', done: false },
    ],
    inbox: [
      {
        id: id(),
        from: 'Ahmed',
        channel: 'whatsapp',
        text: 'Are we still on for 4pm? I can come to your office instead if easier.',
        receivedAt: at(0, 8, 12),
        replied: false,
      },
      {
        id: id(),
        from: 'Noura (HR)',
        email: 'noura.hr@example.com',
        channel: 'email',
        text: 'Please confirm your attendance for the training session next Sunday at 10am.',
        receivedAt: at(0, 7, 40),
        replied: false,
      },
    ],
    proposals: [],
    conversations: [],
    audit: [],
    agents: [
      { id: 'assistant', name: 'Assistant', needsApprovalFor: '—', enabled: true },
      { id: 'booking', name: 'Booking', needsApprovalFor: 'Every booking and invite', enabled: true },
      { id: 'reminders', name: 'Reminders', needsApprovalFor: 'Every new reminder', enabled: true },
      { id: 'messaging', name: 'Messaging', needsApprovalFor: 'Every message and email (you tap Send)', enabled: true },
      { id: 'planner', name: 'Day planner', needsApprovalFor: 'Adding suggested blocks', enabled: true },
    ],
    drafts: 0,
    usage: { inputTokens: 0, outputTokens: 0, requests: 0 },
    usageLog: [],
    aiCache: {},
    handledMail: {},
    stressDays: {},
    passkeys: [],
    news: { items: [], sources: [] },
    subscriptions: [],
    notifyPrefs: { ...DEFAULT_PREFS },
    sentAlerts: [],
    alerts: [],
    whatsappAcks: {},
    profile: { enabled: true, facts: [] },
  };
}

/** The first-run sample events, so copies saved before they were marked can still be recognised. */
const SAMPLE_EVENTS = new Set(['Team stand-up|Microsoft Teams', 'Call with Sara|Phone', 'Dentist appointment|Clinic', 'Q4 report review|Office']);

/** The saved data, null on a first run, and null (with the unreadable file kept aside) if it is damaged. */
function readSaved(): Partial<State> | null {
  let text: string;
  try {
    text = fs.readFileSync(DATA_FILE, 'utf8');
  } catch {
    return null; // nothing saved yet
  }
  try {
    return JSON.parse(text) as Partial<State>;
  } catch (error) {
    // Starting fresh would overwrite the damaged file on the next save, so keep a copy first.
    const kept = `${DATA_FILE}.damaged-${Date.now()}`;
    writePrivate(kept, text);
    console.error(`\n  The saved data could not be read (${(error as Error).message}). A copy was kept at ${kept}; starting with fresh data.\n`);
    return null;
  }
}

function load(): State {
  const saved = { ...seed(), ...readSaved() } as State;
  for (const e of saved.events) if (SAMPLE_EVENTS.has(`${e.title}|${e.place}`)) e.demo = true;
  // Settings added after the file was saved get their defaults.
  saved.notifyPrefs = { ...DEFAULT_PREFS, ...saved.notifyPrefs };
  saved.profile = { enabled: saved.profile?.enabled !== false, facts: saved.profile?.facts ?? [] };
  return saved;
}

export const state: State = load();

let saveTimer: NodeJS.Timeout | undefined;
/** Writes at most twice a second; a restart picks up where it left off. */
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(flushSave, 500);
}

/** Writes any change not yet written, now (used when the server is told to stop). */
export function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  writePrivate(DATA_FILE, JSON.stringify(state, null, 2));
}

export function audit(event: string, who: string, outcome: AuditEntry['outcome']) {
  state.audit.unshift({ id: id(), at: new Date().toISOString(), event, who, outcome });
  state.audit.length = Math.min(state.audit.length, 200);
  save();
}

export function agentEnabled(agentId: AgentSetting['id']): boolean {
  return state.agents.find((a) => a.id === agentId)?.enabled ?? true;
}

/** MAAI's own events plus those read from your calendars, in time order, each meeting once. */
export function allEvents(): CalendarEvent[] {
  // The sample events only fill an empty app; a real calendar replaces them.
  const own = state.events.filter((e) => !(e.demo && calendarConfigured));
  return dedupeEvents([...own, ...googleEvents()]).events.sort((a, b) => a.start.localeCompare(b.start));
}
