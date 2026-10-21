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
  /** Where it came from: the WhatsApp Business number (Twilio) or the user's own device bot. Unset when pasted in by hand. */
  via?: 'twilio' | 'bot';
  /** Written in a group chat (from the device bot): never answered automatically. */
  group?: boolean;
  /** The email subject, for email the device bot collected. */
  subject?: string;
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
    }
  | {
      id: string;
      kind: 'device';
      status: ProposalStatus;
      /** A short name for the task. */
      title: string;
      /** The exact instruction the device bot gets (editable on the card); for an action, its link or file. */
      task: string;
      /** Something the bot does itself on the device instead of asking Grok. */
      action?: DeviceAction;
      /** The queued command, once approved, so its result can be shown. */
      commandId?: string;
    }
  | {
      id: string;
      kind: 'remember';
      status: ProposalStatus;
      /** The fact to keep about the user, in one short sentence (editable on the card). */
      title: string;
      category: ProfileCategory;
    };

/** What a fact in the user's profile is about. */
export type ProfileCategory = 'preference' | 'person' | 'routine' | 'work' | 'other';

/** One thing MAAI knows about the user. Every fact is visible, editable and deletable in Settings. */
export interface ProfileFact {
  id: string;
  text: string;
  category: ProfileCategory;
  /** Typed by the user, or proposed by MAAI and approved. */
  source: 'user' | 'assistant';
  createdAt: string;
  updatedAt: string;
  /** Always given to MAAI, whatever the question. */
  pinned?: boolean;
  /** How many answers it has helped with. */
  uses: number;
  lastUsedAt?: string;
}

export interface ProfileInfo {
  enabled: boolean;
  facts: ProfileFact[];
  limits: { maxFacts: number; maxLength: number };
}

type ProposalStatus = 'pending' | 'approved' | 'cancelled';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  proposalIds?: string[];
  /** Files shown with this message (names only: their contents are never kept). */
  attachments?: { name: string; kind: 'image' | 'pdf' }[];
}

/** What POST /api/uploads answers: an id to attach to the next chat message. */
export interface UploadInfo {
  id: string;
  name: string;
  kind: 'image' | 'pdf';
  bytes: number;
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
  id: 'assistant' | 'booking' | 'reminders' | 'messaging' | 'planner' | 'device';
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
  /** How loaded the day is, worked out from everything above. */
  stress: Stress;
}

export type StressFactor = 'schedule' | 'tasks' | 'email' | 'whatsapp' | 'reminders' | 'time';
export type StressLevel = 'calm' | 'steady' | 'busy' | 'heavy';

/** The day's load as a score out of 100, with what it is made of. Every point has a visible cause. */
export interface Stress {
  score: number;
  level: StressLevel;
  /** Each part: what was counted, the points it adds, and the most it can add. */
  factors: { key: StressFactor; count: number; points: number; max: number }[];
  /** The parts that add the most, biggest first (empty on a calm day). */
  drivers: StressFactor[];
  /** The highest score of each of the last 7 days, oldest first (today last). */
  week: { day: string; score: number }[];
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
  /** The user's own device bot (WhatsApp and email from their device, and tasks run there). */
  bot?: BotStatus;
  /** How this device signed in: not at all on the computer itself, a PIN at home, a password online. */
  auth?: 'none' | 'pin' | 'password';
  /** Online only: whether saved data is on a disk that survives updates (if not, every update erases it). */
  storage?: { persistent: boolean; dir: string };
  /** Smart voice: a transcription service that understands Arabic and English in one sentence. */
  voice?: { smart: boolean };
  /** Minutes a Face ID device stays open without being used. */
  lockMinutes?: number;
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

/** What Anthropic reports about a rate limit, from the headers of the latest answer. */
export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  /** When the window resets (ISO). */
  resetAt?: string;
}

/** The Anthropic account's own numbers for the key MAAI uses, read from Anthropic's cloud. */
export interface CloudUsage {
  fetchedAt: string;
  /** The key MAAI uses, never in full: how it ends, and what Anthropic calls it if it could be matched. */
  key: { hint: string; matched: boolean; name?: string; id?: string; status?: string; scope?: string };
  /** Latest rate limits Anthropic reported (from the last request MAAI made). */
  limits?: { updatedAt: string; requests?: RateLimitInfo; tokens?: RateLimitInfo; inputTokens?: RateLimitInfo; outputTokens?: RateLimitInfo };
  /** Whether the Admin API could be read (usage and cost). */
  reports: 'ok' | 'needs-admin-key' | 'error';
  /** Tokens per day for the last 30 days, for this key when it could be matched, otherwise the whole organization. */
  days: { day: string; uncachedInput: number; cacheRead: number; cacheWrite: number; output: number }[];
  scope: 'key' | 'organization';
  /** Cost in US dollars for the whole organization (Anthropic does not split cost by key). */
  cost?: { last30: number; today: number; days: { day: string; usd: number }[] };
  message?: string;
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
  /** A new WhatsApp message (not from groups), and what MAAI found out from the sender. */
  messages: boolean;
  /** A part of MAAI stopped working (the device bot went silent, Claude failing, data not saving…). */
  health: boolean;
  /** HH:MM in the app's time zone. */
  briefingTime: string;
}

export interface AppAlert {
  id: string;
  at: string;
  kind: 'reminder' | 'leave' | 'event' | 'prayer' | 'briefing' | 'message' | 'health' | 'test';
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

type MailCategory = 'decide' | 'reply' | 'fyi' | 'ignore';

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

/** Something MAAI asked the user's device bot to do. Sent once: a command the bot picked up is never sent again. */
/** What the bot can do on the device by itself, each approved one at a time: open a web link, open a file or folder, send a file to the user on WhatsApp. */
export type DeviceAction = 'open_url' | 'open_path' | 'send_file';

export interface BotCommand {
  id: string;
  /** reply: send a WhatsApp message from the user's own number; task: an instruction the user approved. */
  kind: 'reply' | 'task';
  /** A task the bot does itself; text is then the link (open_url) or the file or folder (open_path, send_file). */
  action?: DeviceAction;
  /** For a reply: the number, digits only, and who it is. */
  phone?: string;
  toName?: string;
  text: string;
  /** Sent by MAAI by itself (the fixed note), not approved one by one. */
  automatic?: boolean;
  status: 'queued' | 'sent' | 'done' | 'failed' | 'expired';
  createdAt: string;
  sentAt?: string;
  finishedAt?: string;
  /** What the bot reported back (its own words: information, never instructions). */
  result?: string;
}

/** The user's device bot (for example a Grok bot on their own computer or phone) as MAAI sees it. */
export interface BotStatus {
  /** A device key exists. */
  connected: boolean;
  /** The first characters of the key, to recognise it. */
  keyHint?: string;
  /** What the bot calls itself. */
  device?: string;
  lastSeen?: string;
  /** Last time it delivered messages. */
  lastSync?: string;
  /** Connected but silent for more than two hours. */
  stale: boolean;
  /** Commands waiting for the bot to pick them up. */
  waiting: number;
  /** Messages it delivered that are still kept. */
  messages: number;
  /** How MAAI answers new WhatsApp messages by itself: an AI first reply that asks for details, the fixed note, or nothing. */
  replyMode: ReplyMode;
  /** Contacts the bot shared from the phone (names and numbers), for finding someone by name. */
  contacts: number;
}

export type ReplyMode = 'smart' | 'fixed' | 'off';

export interface BotOverview {
  status: BotStatus;
  commands: BotCommand[];
}

/** One line in the Inbox: an email or a WhatsApp conversation, tagged with where it came from. */
export interface FeedItem {
  key: string;
  channel: 'email' | 'whatsapp';
  /** Gmail (read by MAAI), the device bot, the WhatsApp Business number, or pasted in. */
  source: 'gmail' | 'bot' | 'twilio' | 'manual';
  from: string;
  subject?: string;
  /** One short line: MAAI's gist, else the start of the message. */
  text: string;
  /** The full text, shown when opened. */
  body: string;
  at: string;
  /** Still needs the user (unread, or not answered). */
  waiting: boolean;
  priority?: 'high' | 'normal' | 'low';
  suggestion?: string;
  options?: string[];
  /** Gmail number, for asking the assistant about it. */
  uid?: number;
  /** The latest message, for the reply screen. */
  message?: InboxMessage;
  /** What MAAI's first reply found out from the sender (smart replies). */
  intake?: string;
  handled?: boolean;
}

export interface InboxFeed {
  fetchedAt: string;
  summary: string;
  items: FeedItem[];
  bot: BotStatus;
}

/** How many contacts MAAI has: imported from a contacts file, and read from WhatsApp by the device bot. */
export interface ContactCount {
  imported: number;
  importedAt?: string;
  fromWhatsApp: number;
}

export type HealthLevel = 'ok' | 'warn' | 'fail' | 'off';

/** One part of the server, checked. */
export interface HealthCheck {
  id: string;
  name: string;
  status: HealthLevel;
  /** What was found, in a sentence. */
  detail: string;
  /** What to do about it, when something is wrong. */
  fix?: string;
}

/** The whole server's health: the worst of its checks. */
export interface HealthReport {
  status: Exclude<HealthLevel, 'off'>;
  checkedAt: string;
  /** The deployed code (short commit id), when the host reports it. */
  version?: string;
  startedAt: string;
  checks: HealthCheck[];
}
