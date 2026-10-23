import type { Proposal } from '../shared/types.js';
import { addFact } from './profile.js';
import { config } from './config.js';
import { firstPrayerTime } from './notify.js';
import { sendMail } from './mail.js';
import { createTask, updateTask, validateNewTask } from './asana.js';
import { mirrorToGoogle } from './gwrite.js';
import { canAnswer, sendWhatsApp, whatsappConfigured } from './whatsapp.js';
import { botConnected, botReplyTarget, deviceTarget, queueCommand } from './bot.js';
import { signed } from './intake.js';
import { markHandled, markReplyTo } from './mail-handled.js';
import { agentEnabled, audit, id, state } from './store.js';
import { HttpError, text } from './routes/http.js';

/** Carrying out the cards the user approves, from the app or from their order number on WhatsApp. */

/** Does what an approved card asks for. The cards are editable, so it uses what the user approved. */
async function carryOut(p: Proposal, body: Record<string, unknown>): Promise<string> {
  switch (p.kind) {
    case 'email': {
      if (!agentEnabled('messaging')) throw new HttpError(403, 'Messaging is switched off by the admin.');
      const mail = { to: text(body.to, 320) || p.to, subject: text(body.subject, 300) || p.subject, body: text(body.body, 20_000) || p.body };
      await sendMail(mail);
      Object.assign(p, mail, { title: mail.subject });
      if (p.replyToUid) markHandled(p.replyToUid, 'replied');
      else markReplyTo(mail.to, 'replied');
      return `Emailed ${mail.to}: ${mail.subject}`;
    }
    case 'whatsapp': {
      if (!agentEnabled('messaging')) throw new HttpError(403, 'Messaging is switched off by the admin.');
      const reply = text(body.body, 1500) || p.body;
      if (!reply) throw new HttpError(400, 'The reply is empty');
      // Someone who wrote to the user's own number is answered from it, through the device bot.
      if (botReplyTarget(p.phone) || (botConnected() && !canAnswer(p.phone))) {
        queueCommand({ kind: 'reply', phone: p.phone, toName: p.toName, text: signed(reply, botReplyTarget(p.phone)?.text) });
        for (const m of state.inbox) if (m.phone === p.phone) m.replied = true;
        Object.assign(p, { body: reply });
        return `Sent a WhatsApp reply to ${p.toName} through the device bot`;
      }
      if (!whatsappConfigured) throw new HttpError(400, 'WhatsApp is not connected yet.');
      if (!canAnswer(p.phone)) throw new HttpError(409, 'WhatsApp only allows a reply within 24 hours of their last message. Open WhatsApp and write to them yourself.');
      await sendWhatsApp(p.phone, reply);
      for (const m of state.inbox) if (m.phone === p.phone) m.replied = true;
      Object.assign(p, { body: reply });
      return `Sent a WhatsApp reply to ${p.toName}`;
    }
    case 'meeting': {
      const option = p.options.find((o) => o.start === text(body.start, 40)) ?? p.options[0];
      if (!option) throw new HttpError(400, 'This card has no time to book.');
      p.chosen = option.start;
      const event = { id: id(), title: p.title, start: option.start, minutes: p.minutes, place: p.attendeeEmail, bookedByMaai: true };
      state.events.push(event);
      markHandled(p.emailUid, 'meeting');
      const google = await mirrorToGoogle(event);
      if (google) Object.assign(p, { google: google.status, googleError: google.status === 'failed' ? google.error : undefined });
      return `Booked: ${p.title}${google?.status === 'added' ? ' (also in Google Calendar)' : ''}`;
    }
    case 'asana': {
      // The card is editable: apply exactly what the user approved.
      const change = { comment: text(body.comment, 5000), complete: body.complete === true, dueOn: text(body.dueOn, 10) };
      if (change.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(change.dueOn)) throw new HttpError(400, 'The due date must look like 2026-10-20.');
      if (!change.comment && !change.complete && !change.dueOn) throw new HttpError(400, 'Nothing to change: add a comment, mark it done, or set a date.');
      await updateTask(p.taskGid, change);
      Object.assign(p, change);
      return `Updated Asana task: ${p.taskName}`;
    }
    case 'asana_new': {
      // The card is editable: create exactly what the user approved.
      const task = validateNewTask({ name: body.name ?? p.title, notes: body.notes ?? p.notes, dueOn: body.dueOn ?? p.dueOn, projectGid: body.projectGid ?? p.projectGid });
      const created = await createTask(task);
      Object.assign(p, { title: task.name, notes: task.notes, dueOn: task.dueOn, projectGid: task.projectGid, taskUrl: created.url });
      return `Created Asana task: ${task.name}`;
    }
    case 'device': {
      if (!agentEnabled('device')) throw new HttpError(403, 'Tasks on the device are switched off by the admin.');
      // The card is editable: send exactly what the user approved.
      let task = text(body.task, p.action === 'open_url' ? 2000 : 1000) || p.task;
      if (!task) throw new HttpError(400, 'The task is empty');
      if (p.action) {
        try {
          task = deviceTarget(p.action, task);
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : 'That cannot be used.');
        }
      }
      const command = queueCommand({ kind: 'task', text: task, ...(p.action ? { action: p.action } : {}) });
      Object.assign(p, { task, commandId: command.id });
      return `Sent to the device bot: ${p.title}`;
    }
    case 'remember': {
      // The card is editable: keep exactly what the user approved.
      const fact = addFact({ text: body.text ?? p.title, category: body.category ?? p.category, source: 'assistant' });
      Object.assign(p, { title: fact.text, category: fact.category });
      return `Remembered: ${fact.text}`;
    }
    case 'reminder': {
      // A prayer reminder has no clock time of its own: record the first day, so a "once" or weekly one is not repeated every day.
      const at = p.at ?? (p.prayer ? firstPrayerTime(p.prayer, p.offsetMinutes ?? 0, new Date(), config.latitude, config.longitude).toISOString() : undefined);
      state.reminders.push({ id: id(), title: p.title, when: p.when, at, prayer: p.prayer, offsetMinutes: p.offsetMinutes, repeat: p.repeat, done: false });
      return `Saved reminder: ${p.title}`;
    }
  }
}

/** Cards being carried out right now: a second tap or a network retry must not send, book or create the same thing twice. */
const approving = new Set<string>();


/** Carries out a pending card once (a second tap, a retry or a second approval cannot do it twice), and logs who approved it. */
export async function approveCard(p: Proposal, body: Record<string, unknown>, who: string): Promise<string> {
  if (p.status !== 'pending') throw new HttpError(409, `Already ${p.status}`);
  if (approving.has(p.id)) throw new HttpError(409, 'Already being done: one moment.');
  approving.add(p.id);
  try {
    const done = await carryOut(p, body);
    p.status = 'approved';
    audit(done, who, 'approved');
    return done;
  } finally {
    approving.delete(p.id);
  }
}

/** Cancels a pending card (not one being carried out right now). */
export function cancelCard(p: Proposal, who: string): void {
  if (p.status === 'pending' && !approving.has(p.id)) {
    p.status = 'cancelled';
    audit(`Cancelled ${p.kind}: ${p.title}`, who, 'cancelled');
  }
}
