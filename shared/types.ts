/** Data shared by the server and the app. Times are ISO 8601 strings. */

export type Lang = 'en' | 'ar';
export type PrayerName = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  minutes: number;
  /** Where or how it happens: "Microsoft Teams", "Clinic, Olaya St". */
  place?: string;
  /** Minutes of travel before it starts; drives the "leave by" hint. */
  travelMinutes?: number;
  /** Where it comes from: MAAI's own calendar, or read from Google Calendar. */
  source?: 'maai' | 'google';
  /** An all-day event (no set time). */
  allDay?: boolean;
  /** Sample data from the first run; hidden once a real calendar is connected. */
  demo?: boolean;
  /** Set when MAAI booked it on the user's behalf. */
  bookedByMaai?: boolean;
}

export interface Reminder {
  id: string;
  title: string;
  /** Human wording kept as said, e.g. "15 min after Maghrib". */
  when: string;
  /** Resolved time, when MAAI could work one out. For daily/weekly, the time of day (and weekday) repeats. */
  at?: string;
  /** Tied to a prayer instead of a clock time: fires `offsetMinutes` after it (negative = before). */
  prayer?: PrayerName;
  offsetMinutes?: number;
  repeat: 'once' | 'daily' | 'weekly';
  done: boolean;
}

export interface InboxMessage {
  id: string;
  from: string;
  /** Email address, for replying by email. */
  email?: string;
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
      prayer?: PrayerName;
      offsetMinutes?: number;
      repeat: Reminder['repeat'];
    }
  | {
      id: string;
      kind: 'email';
      status: ProposalStatus;
      title: string;
      to: string;
      toName?: string;
      subject: string;
      body: string;
    }
  | {
      id: string;
      kind: 'asana';
      status: ProposalStatus;
      title: string;
      taskGid: string;
      taskName: string;
      taskUrl?: string;
      /** A comment to post on the task (empty for none). */
      comment: string;
      /** Mark the task done. */
      complete: boolean;
      /** A new due date, YYYY-MM-DD (empty for none). */
      dueOn: string;
    }
  | {
      id: string;
      kind: 'asana_new';
      status: ProposalStatus;
      /** The new task's name. */
      title: string;
      notes: string;
      /** YYYY-MM-DD, or empty for no date. */
      dueOn: string;
      /** The project to put it in, or empty for just the user's own tasks. */
      projectGid: string;
      taskUrl?: string;
    };

export type ProposalStatus = 'pending' | 'approved' | 'cancelled';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  proposalIds?: string[];
}

/** Live progress while MAAI works: its thinking, each step ("read_email", then "read_email:done"), the reply as it is written. */
export type ChatEvent =
  | { type: 'thinking'; text: string }
  | { type: 'step'; tool: string; detail?: string }
  | { type: 'text'; text: string };

/** What POST /api/chat/stream sends: progress events, then exactly one done or error. */
export type StreamEvent = ChatEvent | { type: 'done'; reply: string; proposals: Proposal[] } | { type: 'error'; error: string };

/** GET /api/today */
export interface TodayData {
  events: CalendarEvent[];
  reminders: Reminder[];
  prayers: { name: PrayerName; time: string }[];
  nextPrayer: { name: PrayerName; time: string };
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
  /** Gmail connected for sending, and from which address. */
  mail?: { configured: boolean; from: string; inbox?: boolean };
  /** Google Calendar, read through its private iCal address. */
  calendar?: CalendarStatus;
  /** Asana, read through a personal access token. */
  asana?: AsanaStatus;
  /** How this device signed in: not at all on the computer itself, a PIN at home, a password online. */
  auth?: 'none' | 'pin' | 'password';
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

/** Which alerts MAAI sends. */
export interface NotifyPrefs {
  reminders: boolean;
  /** "Time to leave" for events with travel time. */
  leave: boolean;
  /** Heads-up before every event. */
  events: boolean;
  eventMinutes: number;
  prayers: boolean;
  prayerMinutes: number;
}

export interface AppAlert {
  id: string;
  at: string;
  kind: 'reminder' | 'leave' | 'event' | 'prayer' | 'test';
  title: string;
  body: string;
}

export interface NotifyStatus {
  publicKey: string;
  devices: number;
  prefs: NotifyPrefs;
}

/** An email from the user's Gmail inbox (read-only copy, kept in memory). */
export interface MailItem {
  uid: number;
  fromName: string;
  fromAddress: string;
  subject: string;
  date: string;
  unread: boolean;
  /** Plain text, quoted history removed, shortened. */
  body: string;
}

export type MailCategory = 'decide' | 'reply' | 'fyi' | 'ignore';

/** MAAI's read of one email: what it is and what to do about it. */
export interface MailInsight {
  uid: number;
  category: MailCategory;
  priority: 'high' | 'normal' | 'low';
  gist: string;
  suggestion: string;
  /** Choices for a decision, recommended first. Empty when there is nothing to decide. */
  options: string[];
}

export interface MailDigest {
  fetchedAt: string;
  summary: string;
  source: 'claude' | 'demo';
  emails: (MailItem & { insight?: MailInsight })[];
}

export interface CalendarStatus {
  configured: boolean;
  events: number;
  lastSync?: string;
  error?: string;
  /** Each calendar MAAI reads, so a missing one is easy to spot. */
  sources?: { name: string; events: number; error?: string }[];
  /** Same event in two calendars, shown once. */
  merged?: number;
}

/** An Asana task assigned to the user. */
export interface AsanaTask {
  gid: string;
  name: string;
  /** YYYY-MM-DD, if it has a due date. */
  dueOn?: string;
  notes?: string;
  url: string;
  project?: string;
}

export interface AsanaProject {
  gid: string;
  name: string;
}

/**
 * One way to change a task's status: the column it sits in on a project's board
 * (type "section"), or a dropdown field such as "Status" (type "field").
 */
export interface AsanaControl {
  type: 'section' | 'field';
  /** What it changes: the project name, or the field name. */
  label: string;
  /** For a field, its id (a section needs none). */
  fieldGid?: string;
  /** The option the task has now. */
  current?: string;
  options: { gid: string; name: string }[];
}

export interface AsanaStatus {
  configured: boolean;
  open: number;
  overdue: number;
  dueToday: number;
  error?: string;
}

/** GET /api/asana: the tasks that matter now, for Today. */
export interface AsanaOverview extends AsanaStatus {
  tasks: AsanaTask[];
}
