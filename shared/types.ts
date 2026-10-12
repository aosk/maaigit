/** Data shared by the server and the app. Times are ISO 8601 strings. */

export type Lang = 'en' | 'ar';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  minutes: number;
  /** Where or how it happens: "Microsoft Teams", "Clinic, Olaya St". */
  place?: string;
  /** Minutes of travel before it starts; drives the "leave by" hint. */
  travelMinutes?: number;
  /** Set when MAAI booked it on the user's behalf. */
  bookedByMaai?: boolean;
}

export interface Reminder {
  id: string;
  title: string;
  /** Human wording kept as said, e.g. "15 min after Maghrib". */
  when: string;
  /** Resolved time, when MAAI could work one out. */
  at?: string;
  repeat: 'once' | 'daily' | 'weekly';
  done: boolean;
}

export interface InboxMessage {
  id: string;
  from: string;
  /** Phone number in international format, digits only, for the WhatsApp hand-off. */
  phone?: string;
  channel: 'whatsapp' | 'email' | 'sms';
  text: string;
  receivedAt: string;
  replied: boolean;
}

export type Tone = 'short' | 'friendly' | 'formal' | 'arabic';

/** Something MAAI wants to do. Nothing happens until the user approves it. */
export type Proposal =
  | {
      id: string;
      kind: 'meeting';
      status: ProposalStatus;
      title: string;
      attendee: string;
      attendeeEmail?: string;
      minutes: number;
      options: { start: string; note?: string }[];
      chosen?: string;
    }
  | {
      id: string;
      kind: 'reminder';
      status: ProposalStatus;
      title: string;
      when: string;
      at?: string;
      repeat: Reminder['repeat'];
    };

export type ProposalStatus = 'pending' | 'approved' | 'cancelled';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  proposalIds?: string[];
}

export interface AuditEntry {
  id: string;
  at: string;
  event: string;
  who: string;
  outcome: 'done' | 'approved' | 'cancelled' | 'blocked' | 'error';
}

export interface AgentSetting {
  id: 'assistant' | 'booking' | 'reminders' | 'messaging' | 'planner';
  name: string;
  needsApprovalFor: string;
  enabled: boolean;
}

export interface Briefing {
  text: string;
  source: 'claude' | 'demo';
}

export interface StatusInfo {
  aiConfigured: boolean;
  model: string;
  location: { latitude: number; longitude: number; timezone: string };
}

export interface AdminOverview {
  counts: {
    events: number;
    reminders: number;
    proposals: number;
    approved: number;
    cancelled: number;
    drafts: number;
    chats: number;
  };
  approvalRate: number | null;
  agents: AgentSetting[];
  audit: AuditEntry[];
  status: StatusInfo;
  usage: { inputTokens: number; outputTokens: number; requests: number };
}
