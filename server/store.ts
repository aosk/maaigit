import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { googleEvents } from './gcal.js';
import type {
  AgentSetting,
  AppAlert,
  AuditEntry,
  CalendarEvent,
  ChatTurn,
  InboxMessage,
  Lang,
  NotifyPrefs,
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

export interface State {
  events: CalendarEvent[];
  reminders: Reminder[];
  inbox: InboxMessage[];
  proposals: Proposal[];
  conversations: Conversation[];
  audit: AuditEntry[];
  agents: AgentSetting[];
  drafts: number;
  usage: { inputTokens: number; outputTokens: number; requests: number };
  /** Phones and browsers that turned on notifications. */
  subscriptions: { subscription: { endpoint: string; keys: { p256dh: string; auth: string } }; lang: Lang; createdAt: string }[];
  notifyPrefs: NotifyPrefs;
  /** Keys of alerts already sent, so each goes out once. */
  sentAlerts: string[];
  /** Recent alerts, for the banner in the open app. */
  alerts: AppAlert[];
}

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
      { id: id(), title: 'Team stand-up', start: at(0, 9, 0), minutes: 15, place: 'Microsoft Teams' },
      { id: id(), title: 'Call with Sara', start: at(0, 11, 30), minutes: 30, place: 'Phone', bookedByMaai: true },
      { id: id(), title: 'Dentist appointment', start: at(0, 16, 0), minutes: 45, place: 'Clinic', travelMinutes: 18 },
      { id: id(), title: 'Q4 report review', start: at(1, 10, 0), minutes: 60, place: 'Office' },
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
    subscriptions: [],
    notifyPrefs: { reminders: true, leave: true, events: false, eventMinutes: 10, prayers: false, prayerMinutes: 10 },
    sentAlerts: [],
    alerts: [],
  };
}

function load(): State {
  try {
    return { ...seed(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch {
    return seed();
  }
}

export const state: State = load();

let saveTimer: NodeJS.Timeout | undefined;
/** Writes at most twice a second; a restart picks up where it left off. */
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  }, 500);
}

export function audit(event: string, who: string, outcome: AuditEntry['outcome']) {
  state.audit.unshift({ id: id(), at: new Date().toISOString(), event, who, outcome });
  state.audit.length = Math.min(state.audit.length, 200);
  save();
}

export function agentEnabled(agentId: AgentSetting['id']): boolean {
  return state.agents.find((a) => a.id === agentId)?.enabled ?? true;
}

/** MAAI's own events plus those read from Google Calendar, in time order. */
export function allEvents(): CalendarEvent[] {
  return [...state.events, ...googleEvents()].sort((a, b) => a.start.localeCompare(b.start));
}
