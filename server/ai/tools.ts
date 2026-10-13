import type { PrayerName, Proposal } from '../../shared/types.js';
import { clashesWithPrayer, prayersFor } from '../../shared/prayer.js';
import { agentEnabled, id } from '../store.js';
import { config } from '../config.js';
import { isEmail, mailConfigured } from '../mail.js';
import { cachedInbox, getEmail } from '../gmail-inbox.js';
import { emailForClaude } from './context.js';
import type { Tool, ToolResult, ToolUse } from './claude.js';

/**
 * The tools Claude can call. The propose_* tools only create a pending
 * approval card in `created`; the server acts when the user approves.
 */

/** A tool call Claude should correct: the message goes back to it as an error result. */
class ToolError extends Error {}

interface ToolSpec<Input> {
  definition: Omit<Tool, 'name' | 'strict'>;
  run: (input: Input, created: Proposal[]) => string | Promise<string>;
  /** A few words about what the finished step did, for the progress list. */
  detail?: (input: Input, created: Proposal[]) => string | undefined;
}

const lastTitle = (_: unknown, created: Proposal[]) => created[created.length - 1]?.title;

function requireAgent(agent: Parameters<typeof agentEnabled>[0], message: string) {
  if (!agentEnabled(agent)) throw new ToolError(message);
}

const read_email: ToolSpec<{ uid: number }> = {
  definition: {
    description: "Read one email from the user's Gmail inbox by its number (#uid, listed in the context). Read-only.",
    input_schema: {
      type: 'object',
      properties: { uid: { type: 'integer', description: 'The email number, e.g. 4812 for #4812.' } },
      required: ['uid'],
      additionalProperties: false,
    },
  },
  async run({ uid }) {
    const mail = await getEmail(uid).catch((error: Error) => {
      throw new ToolError(error.message);
    });
    if (!mail) throw new ToolError(`No email #${uid} in the last two weeks of the inbox.`);
    return emailForClaude(mail);
  },
  detail: ({ uid }) => {
    const mail = cachedInbox().find((m) => m.uid === uid);
    return mail ? `${mail.fromName}: ${mail.subject}` : undefined;
  },
};

const propose_email: ToolSpec<{ to: string; to_name: string; subject: string; body: string }> = {
  definition: {
    description: 'Show the user an editable approval card for an email from their own Gmail. Nothing is sent until the user taps Send.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address exactly as the user gave it.' },
        to_name: { type: 'string', description: 'Recipient name if known, else an empty string.' },
        subject: { type: 'string', description: 'Short subject line.' },
        body: { type: 'string', description: 'The full email text, signed as the user.' },
      },
      required: ['to', 'to_name', 'subject', 'body'],
      additionalProperties: false,
    },
  },
  run(input, created) {
    requireAgent('messaging', 'Messaging is switched off by the admin.');
    if (!isEmail(input.to)) throw new ToolError(`"${input.to}" is not an email address. Ask the user for the recipient's email address.`);
    created.push({
      id: id(),
      kind: 'email',
      status: 'pending',
      title: input.subject,
      to: input.to.trim(),
      toName: input.to_name || undefined,
      subject: input.subject,
      body: input.body,
    });
    return mailConfigured
      ? 'Email card shown. Not sent yet; waiting for the user to tap Send.'
      : 'Email card shown. Gmail is not connected, so the user can open it in their mail app instead.';
  },
  detail: lastTitle,
};

const propose_meeting: ToolSpec<{ title: string; attendee: string; attendee_email: string; minutes: number; options: { start: string; note: string }[] }> = {
  definition: {
    description: 'Show the user an approval card for booking a meeting. Nothing is booked until the user approves and picks one of the options.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short meeting title, e.g. "Meeting with Sara".' },
        attendee: { type: 'string', description: 'Who the meeting is with.' },
        attendee_email: { type: 'string', description: 'Email if the user gave one, else an empty string.' },
        minutes: { type: 'integer', description: 'Length in minutes.' },
        options: {
          type: 'array',
          description: 'One to three candidate start times.',
          items: {
            type: 'object',
            properties: {
              start: { type: 'string', description: 'ISO 8601 start time with timezone offset.' },
              note: { type: 'string', description: 'Why this slot, a few words ("Best fit"), or empty.' },
            },
            required: ['start', 'note'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'attendee', 'attendee_email', 'minutes', 'options'],
      additionalProperties: false,
    },
  },
  run(input, created) {
    requireAgent('booking', 'Booking is switched off by the admin. Tell the user you cannot book right now.');
    const options = input.options
      .map((o) => ({ start: new Date(o.start), note: o.note || undefined }))
      .filter((o) => !Number.isNaN(o.start.getTime()))
      .filter((o) => !clashesWithPrayer(o.start, input.minutes, prayersFor(o.start, config.latitude, config.longitude)))
      .slice(0, 3)
      .map((o) => ({ start: o.start.toISOString(), note: o.note }));
    if (!options.length) throw new ToolError('None of those times work (invalid or during a prayer time). Pick other free times and call propose_meeting again.');
    created.push({
      id: id(),
      kind: 'meeting',
      status: 'pending',
      title: input.title,
      attendee: input.attendee,
      attendeeEmail: input.attendee_email || undefined,
      minutes: input.minutes,
      options,
    });
    return `Approval card shown with ${options.length} option(s). Not booked yet; waiting for the user.`;
  },
  detail: lastTitle,
};

const propose_reminder: ToolSpec<{ title: string; when: string; at: string; after_prayer: PrayerName | 'none'; offset_minutes: number; repeat: 'once' | 'daily' | 'weekly' }> = {
  definition: {
    description: 'Show the user an approval card for a new reminder. Nothing is saved until the user approves.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What to be reminded about.' },
        when: { type: 'string', description: 'When, in the user\'s own words, e.g. "15 min after Maghrib".' },
        at: { type: 'string', description: 'ISO 8601 time of the first reminder for clock-time reminders, else an empty string.' },
        after_prayer: {
          type: 'string',
          enum: ['none', 'fajr', 'dhuhr', 'asr', 'maghrib', 'isha'],
          description: 'For reminders tied to a prayer ("after Maghrib"), which prayer; else "none".',
        },
        offset_minutes: { type: 'integer', description: 'Minutes after that prayer (negative for before). 0 when after_prayer is "none".' },
        repeat: { type: 'string', enum: ['once', 'daily', 'weekly'] },
      },
      required: ['title', 'when', 'at', 'after_prayer', 'offset_minutes', 'repeat'],
      additionalProperties: false,
    },
  },
  run(input, created) {
    requireAgent('reminders', 'Reminders are switched off by the admin.');
    const prayer = input.after_prayer === 'none' ? undefined : input.after_prayer;
    created.push({
      id: id(),
      kind: 'reminder',
      status: 'pending',
      title: input.title,
      when: input.when,
      at: input.at && !Number.isNaN(Date.parse(input.at)) ? new Date(input.at).toISOString() : undefined,
      prayer,
      offsetMinutes: prayer ? input.offset_minutes : undefined,
      repeat: input.repeat,
    });
    return 'Approval card shown. Not saved yet; waiting for the user.';
  },
  detail: lastTitle,
};

const SPECS: Record<string, ToolSpec<any>> = { read_email, propose_email, propose_meeting, propose_reminder };

export const tools: Tool[] = Object.entries(SPECS).map(([name, spec]) => ({ name, strict: true, ...spec.definition }) as Tool);

/** Runs one tool call and returns its result for Claude, plus a short note for the progress list. */
export async function runTool(block: ToolUse, created: Proposal[]): Promise<{ result: ToolResult; detail?: string }> {
  const spec = SPECS[block.name];
  const reply = (content: string, isError = false): ToolResult => ({ type: 'tool_result', tool_use_id: block.id, content, is_error: isError || undefined });
  if (!spec) return { result: reply(`Unknown tool ${block.name}.`, true) };
  try {
    const text = await spec.run(block.input, created);
    return { result: reply(text), detail: spec.detail?.(block.input, created) };
  } catch (error) {
    if (error instanceof ToolError) return { result: reply(error.message, true) };
    throw error;
  }
}
