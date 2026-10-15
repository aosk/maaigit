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
  /** Which calendar it was read from, such as "Google Calendar" or "iPhone (iCloud)". */
  calendar?: string;
  /** The event's own notes (plain text). */
  description?: string;
  /** A link to join it (Google Meet, Zoom, Teams…), when it has one. */
  meetingUrl?: string;
  /** Set once the event has been added to Google Calendar. */
  googleId?: string;
  /** Why adding it to Google Calendar failed, if it did. */
  googleError?: string;
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
  /** Set when the message arrived on the WhatsApp Business number (not pasted in by hand). */
  via?: 'twilio';
  /** The provider's id for the message, so a message delivered twice is kept once. */
  externalId?: string;
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
      /** Whether the booked meeting also reached Google Calendar. */
      google?: 'added' | 'failed';
      googleError?: string;
      /** The inbox email this meeting came from, so it can be marked as handled once booked. */
      emailUid?: number;
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
      /** The inbox email this answers, so it can be marked as handled once sent. */
      replyToUid?: number;
    }
  | {
      id: string;
      kind: 'whatsapp';
      status: ProposalStatus;
      title: string;
      /** Who the reply is to. */
      toName: string;
      /** Their number, digits only. */
      phone: string;
      body: string;
      /** MAAI can send it itself: the number is connected and they wrote within the last 24 hours. */
      canSend: boolean;
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

type ProposalStatus = 'pending' | 'approved' | 'cancelled';

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
  /** When everything (calendars, Asana, mail) was last refreshed from its source. */
  syncedAt?: string;
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
  /** Which briefing this is: morning, noon or night. */
  period: 'morning' | 'noon' | 'night';
  text: string;
  source: 'claude' | 'demo';
}

/** The numbers behind the briefing card: what is next and what is waiting, counted fresh with no AI call. */
export interface BriefingFacts {
  /** The next event that has not started, with when to leave if it has travel time. */
  next?: { id: string; title: string; start: string; place?: string; leaveAt?: string };
  events: { left: number; total: number };
  tasks: { overdue: number; dueToday: number };
  reminders: { open: number };
  email: { unread: number; toDecide: number; toReply: number };
  whatsapp: { waiting: number };
}

export type NewsSection = 'tech' | 'saudi';

/** One story in the news section: a headline from a trusted source, with a short summary written by MAAI. */
export interface NewsItem {
  id: string;
  title: string;
  /** One sentence in the app's language (empty if MAAI could not write one). */
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  /** Other trusted sources that reported the same story. */
  alsoBy: string[];
}

/** A headline as read from a feed, before MAAI ranks it. */
export interface NewsRaw {
  id: string;
  section: NewsSection;
  source: string;
  title: string;
  /** A short plain-text excerpt from the feed. */
  snippet: string;
  url: string;
  publishedAt: string;
}

export interface NewsDigest {
  /** When the sources were last read. */
  fetchedAt?: string;
  source: 'claude' | 'ranked';
  sections: Record<NewsSection, NewsItem[]>;
  /** Each trusted source and whether it could be read last time, so a broken one is easy to see. */
  sources: { name: string; section: NewsSection; ok: boolean; items: number; error?: string }[];
  /** Hours between automatic updates. */
  everyHours: number;
}

export interface StatusInfo {
  aiConfigured: boolean;
  /** Gmail connected for sending, and from which address. */
  mail?: { configured: boolean; from: string; inbox?: boolean };
  /** Google Calendar, read through its private iCal address. */
  calendar?: CalendarStatus;
  /** Asana, read through a personal access token. */
  asana?: AsanaStatus;
  /** The news section: when it was last updated, and how many trusted sources are working. */
  news?: { updatedAt?: string; sourcesOk: number; sources: number };
  /** WhatsApp Business number, read and answered through Twilio. */
  whatsapp?: WhatsAppStatus;
  /** How this device signed in: not at all on the computer itself, a PIN at home, a password online. */
  auth?: 'none' | 'pin' | 'password';
  model: string;
  location: { latitude: number; longitude: number; timezone: string };
}

/** What a Claude request was for, so token use can be split by feature. */
export type UsagePurpose = 'chat' | 'briefing' | 'email-digest' | 'email-draft' | 'whatsapp' | 'news';

/** One day's Claude use for one feature. `input` excludes tokens read from the cache, which are in `cached`. */
export interface UsageRow {
  /** YYYY-MM-DD in the app's time zone. */
  day: string;
  purpose: UsagePurpose;
  input: number;
  cached: number;
  output: number;
  requests: number;
  /** Times the saved answer was reused because nothing had changed (no tokens spent). */
  hits?: number;
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
  /** Claude use per day and feature, the last 30 days. */
  usageLog: UsageRow[];
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
  /** A daily summary of the day, written by MAAI, at `briefingTime`. */
  briefing: boolean;
  /** HH:MM in the app's time zone. */
  briefingTime: string;
}

export interface AppAlert {
  id: string;
  at: string;
  kind: 'reminder' | 'leave' | 'event' | 'prayer' | 'briefing' | 'test';
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
  emails: (MailItem & { insight?: MailInsight; handled?: { how: 'replied' | 'meeting'; at: string } })[];
}

/** One person's WhatsApp messages, read and sorted by MAAI. */
export interface WhatsAppThread {
  /** Stable key: the phone number, or the name when there is no number. */
  key: string;
  name: string;
  phone?: string;
  /** Oldest first. */
  messages: InboxMessage[];
  lastAt: string;
  unanswered: number;
  /** MAAI can send the reply itself (the number is connected and they wrote within the last 24 hours). */
  canReply: boolean;
  insight?: Omit<MailInsight, 'uid'>;
}

export interface WhatsAppDigest {
  fetchedAt: string;
  summary: string;
  source: 'claude' | 'demo';
  /** Days messages are kept before they are deleted. */
  keepDays: number;
  threads: WhatsAppThread[];
}

export interface WhatsAppStatus {
  configured: boolean;
  /** The WhatsApp Business number messages arrive on. */
  number?: string;
  keepDays: number;
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
  /** Whether meetings made in MAAI are also written into Google Calendar. */
  write?: CalendarWriteStatus;
}

export interface CalendarWriteStatus {
  /** Any of the Google Calendar writing settings has been added. */
  configured: boolean;
  /** Set up and the last attempt worked. */
  working: boolean;
  calendar?: string;
  /** The robot account's address, which the calendar must be shared with. */
  shareWith?: string;
  error?: string;
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
  /** When it was created in Asana. */
  createdAt?: string;
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
