import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/team-rem-data',
    MAAI_DATA_FILE: '/tmp/claude-0/team-rem-data/store.json',
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_WHATSAPP_FROM: '',
    ASANA_TOKEN: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
    GOOGLE_CALENDAR_ICS_URL: '',
  });
});

import { createKey, resetLink, revokeKey, takeCommands } from './bot';
import { state } from './store';
import { nextAction, teamReminderTick } from './team-reminders';
import { addTeam, createDuty, saveMember, saveTeamSettings, updateDuty } from './teams';

const PHONE = '966501111111';
const ALERT = '966509999999';
const H = 3_600_000;
// Sunday 15 Nov 2026, 09:00 Riyadh (06:00Z): a working day, inside the hours.
const SUN = new Date('2026-11-15T06:00:00Z');
const at = (base: Date, hours: number) => new Date(base.getTime() + hours * H);

let dutyId = '';
/** A follow-up due Wednesday 12:00 Riyadh (09:00Z), for Ahmed in the Najiz team. */
function setUp(due = '2026-11-18T12:00:00+03:00') {
  const team = addTeam('ناجز');
  saveMember({ phone: '0501111111', name: 'أحمد', teamIds: [team.id] });
  dutyId = createDuty({ title: 'تقديم الطلب في ناجز', phone: PHONE, due }, SUN).id;
}
const duty = () => state.duties.find((d) => d.id === dutyId)!;
const sent = () => takeCommands(0).filter((c) => c.phone === PHONE);

beforeEach(() => {
  state.teams = [];
  state.teamMembers = [];
  state.duties = [];
  state.teamSettings = { enabled: true, fromHour: 8, toHour: 21, hoursBetween: 4, alertPhone: ALERT };
  state.bot = { commands: [] };
  createKey();
  resetLink();
});

describe('the reminders', () => {
  it('start a day before the follow-up is due, in Arabic, marked as automatic', () => {
    setUp();
    expect(teamReminderTick(SUN)).toBe(0); // three days away
    const dayBefore = new Date('2026-11-17T10:00:00+03:00'); // Tuesday, 26 hours before: not yet
    expect(teamReminderTick(dayBefore)).toBe(0);
    const inside = new Date('2026-11-17T13:00:00+03:00'); // 23 hours before
    expect(teamReminderTick(inside)).toBe(1);
    const [c] = sent();
    expect(c.text).toContain('أحمد');
    expect(c.text).toContain('تقديم الطلب في ناجز');
    expect(c.text).toContain('🤖');
    expect(duty().reminders).toHaveLength(1);
    expect(duty().reminders[0].n).toBe(1);
    // Not again a minute later.
    expect(teamReminderTick(new Date(inside.getTime() + 60_000))).toBe(0);
  });

  it('send a second one after the wait, then tell the user, and then stop', () => {
    setUp();
    const t1 = new Date('2026-11-17T13:00:00+03:00');
    teamReminderTick(t1);
    takeCommands(0);
    expect(teamReminderTick(at(t1, 3.9))).toBe(0);
    expect(teamReminderTick(at(t1, 4))).toBe(1);
    expect(sent()[0].text).toContain('تذكير ثاني');
    expect(duty().reminders.map((r) => r.n)).toEqual([1, 2]);
    // No answer to the second one either: the user is told (on WhatsApp to the alert number), once.
    expect(teamReminderTick(at(t1, 8))).toBe(1);
    const alert = takeCommands(0).find((c) => c.phone === ALERT)!;
    expect(alert.text).toContain('ما رد على تذكيرين');
    expect(alert.text).toContain('أحمد');
    expect(duty().escalatedAt).toBeDefined();
    expect(duty().status).toBe('open');
    expect(teamReminderTick(at(t1, 12))).toBe(0);
    expect(teamReminderTick(at(t1, 30))).toBe(0);
  });

  it('stop when they answer, and again at the due time if they only said they will do it', () => {
    setUp();
    const t1 = new Date('2026-11-17T13:00:00+03:00');
    teamReminderTick(t1);
    takeCommands(0);
    duty().replies.push({ at: at(t1, 1).toISOString(), text: 'ان شاء الله', intent: 'ack' });
    duty().status = 'acknowledged';
    expect(teamReminderTick(at(t1, 6))).toBe(0);
    // It falls due: one reminder, then the user if that goes unanswered.
    const due = new Date('2026-11-18T12:00:00+03:00');
    expect(teamReminderTick(due)).toBe(1);
    expect(sent()[0].text).toContain('حان موعد');
    expect(teamReminderTick(at(due, 4))).toBe(1);
    expect(takeCommands(0).some((c) => c.phone === ALERT)).toBe(true);
  });

  it('do not go out on Friday or Saturday, nor outside the sending hours, and wait for the next working time', () => {
    setUp();
    const friday = new Date('2026-11-20T10:00:00+03:00');
    state.duties[0].due = new Date('2026-11-21T12:00:00+03:00').toISOString(); // the day before falls on Friday
    expect(teamReminderTick(friday)).toBe(0);
    const saturday = new Date('2026-11-21T09:00:00+03:00');
    expect(teamReminderTick(saturday)).toBe(0);
    state.duties[0].due = new Date('2026-11-24T12:00:00+03:00').toISOString();
    expect(teamReminderTick(new Date('2026-11-23T07:00:00+03:00'))).toBe(0); // before 8
    expect(teamReminderTick(new Date('2026-11-23T21:30:00+03:00'))).toBe(0); // after 21
    expect(teamReminderTick(new Date('2026-11-23T13:00:00+03:00'))).toBe(1); // 23 hours before, inside the hours
  });

  it('are tried again later when the device bot is not connected, and never recorded as sent', () => {
    setUp();
    const t1 = new Date('2026-11-17T13:00:00+03:00');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.bot = { commands: [] }; // no device key: the bot is not connected
    expect(teamReminderTick(t1)).toBe(0);
    expect(duty().reminders).toHaveLength(0);
    createKey();
    resetLink();
    expect(teamReminderTick(at(t1, 0.2))).toBe(1);
    expect(duty().reminders).toHaveLength(1);
  });

  it('are off when the user switches them off, and never more than six a day to one person', () => {
    setUp();
    const t1 = new Date('2026-11-17T13:00:00+03:00');
    state.teamSettings.enabled = false;
    expect(teamReminderTick(t1)).toBe(0);
    state.teamSettings.enabled = true;
    // Six already sent today: no more.
    duty().reminders = Array.from({ length: 6 }, (_, i) => ({ at: at(t1, -i * 0.1).toISOString(), n: 2, text: 'x' }));
    expect(teamReminderTick(t1)).toBe(0);
  });

  it('start over when the user moves the date', () => {
    setUp();
    teamReminderTick(new Date('2026-11-17T13:00:00+03:00'));
    updateDuty(dutyId, { due: '2026-12-10' }, SUN);
    expect(duty().reminders).toEqual([]);
    expect(nextAction(duty(), new Date('2026-11-18T10:00:00+03:00'))).toBeNull();
  });
});

describe('what a follow-up needs next', () => {
  it('is nothing for finished, cancelled and stuck ones', () => {
    setUp();
    for (const status of ['done', 'cancelled', 'blocked'] as const) {
      duty().status = status;
      expect(nextAction(duty(), new Date('2026-11-17T13:00:00+03:00'))).toBeNull();
    }
  });

  it('uses the wait the user chose', () => {
    setUp();
    saveTeamSettings({ hoursBetween: 2 });
    const t1 = new Date('2026-11-17T13:00:00+03:00');
    teamReminderTick(t1);
    expect(nextAction(duty(), at(t1, 1.9))).toBeNull();
    expect(nextAction(duty(), at(t1, 2))).toEqual({ do: 'remind', n: 2 });
  });
});

describe('telling the user when the device bot is away', () => {
  it('keeps the WhatsApp copy of the "did not answer" alert until the bot is back, and sends it once', () => {
    setUp();
    const t1 = new Date('2026-11-17T13:00:00+03:00');
    expect(teamReminderTick(t1)).toBe(1);
    expect(teamReminderTick(at(t1, 4.1))).toBe(1); // second reminder
    takeCommands(0);
    revokeKey(); // the bot is not connected when the alert falls due
    const late = at(t1, 8.3);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(teamReminderTick(late)).toBe(1);
    expect(duty().escalatedAt).toBeDefined();
    expect(duty().alertUnsent).toBe(true);
    expect(teamReminderTick(at(late, 0.1))).toBe(0); // still away: nothing more, no second push
    createKey();
    expect(teamReminderTick(at(late, 0.2))).toBe(1);
    expect(duty().alertUnsent).toBe(false);
    expect(takeCommands(0).filter((c) => c.phone === ALERT)).toHaveLength(1);
    expect(teamReminderTick(at(late, 0.3))).toBe(0);
  });
});
