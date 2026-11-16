import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/teams-data', MAAI_DATA_FILE: '/tmp/claude-0/teams-data/store.json' });
});

import { state } from './store';
import { TeamError, addTeam, createDuty, normalizePhone, removeMember, removeTeam, saveCourier, saveMember, saveTeamSettings, updateDuty, updateTeam } from './teams';

const NOW = new Date('2026-11-16T09:00:00Z');

beforeEach(() => {
  state.teams = [];
  state.teamMembers = [];
  state.duties = [];
  state.teamSettings = { enabled: true, fromHour: 8, toHour: 21, hoursBetween: 4 };
  state.courier = { enabled: false, shortAddress: '', fullDetails: '', doorPhotoPath: '' };
});

describe('phone numbers', () => {
  it('make a Saudi mobile international and refuse what is not a number', () => {
    expect(normalizePhone('0501234567')).toBe('966501234567');
    expect(normalizePhone('+966 50 123 4567')).toBe('966501234567');
    expect(normalizePhone('501234567')).toBe('966501234567');
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('teams and their people', () => {
  it('start with Friday and Saturday off, keep names unique, and let go of a removed team everywhere', () => {
    const najiz = addTeam('  ناجز ');
    expect(najiz).toMatchObject({ name: 'ناجز', offDays: [5, 6] });
    expect(() => addTeam('ناجز')).toThrow(TeamError);
    expect(() => addTeam('   ')).toThrow(TeamError);
    updateTeam(najiz.id, { offDays: [5] });
    expect(state.teams[0].offDays).toEqual([5]);
    expect(() => updateTeam(najiz.id, { offDays: [9] })).toThrow(/Sunday/);
    const lawyers = addTeam('المحامون');
    saveMember({ phone: '0501111111', name: 'أحمد', teamIds: [najiz.id, lawyers.id] });
    createDuty({ title: 'تقديم الطلب', phone: '0501111111', due: '2026-11-19', teamId: najiz.id }, NOW);
    removeTeam(najiz.id);
    expect(state.teamMembers[0].teamIds).toEqual([lawyers.id]);
    expect(state.duties[0].teamId).toBeUndefined();
  });

  it('need a real team and a real number, and write a name as one safe line', () => {
    const t = addTeam('التراخيص');
    expect(() => saveMember({ phone: '12', name: 'x', teamIds: [t.id] })).toThrow(/phone/);
    expect(() => saveMember({ phone: '0501111111', name: 'x', teamIds: ['nope'] })).toThrow(/teams/);
    expect(() => saveMember({ phone: '0501111111', name: 'x', teamIds: [] })).toThrow(/at least one/);
    const m = saveMember({ phone: '0501111111', name: 'خالد\n<b>x</b>‮', teamIds: [t.id] });
    expect(m.name).not.toMatch(/[\n<>‮]/);
    expect(m.lang).toBe('ar');
    saveMember({ phone: '0501111111', name: 'خالد', teamIds: [t.id], lang: 'en' });
    expect(state.teamMembers).toHaveLength(1);
    expect(state.teamMembers[0].lang).toBe('en');
  });
});

describe('follow-ups', () => {
  it('need a person who is in a team, a due date that is real and not past, and can be moved or closed by the user', () => {
    const t = addTeam('ناجز');
    expect(() => createDuty({ title: 'x', phone: '0501111111', due: '2026-11-19' }, NOW)).toThrow(/not in any team/);
    saveMember({ phone: '0501111111', name: 'أحمد', teamIds: [t.id] });
    expect(() => createDuty({ title: 'x', phone: '0501111111', due: 'tomorrow-ish' }, NOW)).toThrow(/date/);
    expect(() => createDuty({ title: 'x', phone: '0501111111', due: '2026-11-01' }, NOW)).toThrow(/passed/);
    expect(() => createDuty({ title: '', phone: '0501111111', due: '2026-11-19' }, NOW)).toThrow(/Say what/);
    const d = createDuty({ title: 'تقديم الطلب', phone: '0501111111', due: '2026-11-19' }, NOW);
    expect(d).toMatchObject({ status: 'open', name: 'أحمد', teamId: t.id, source: 'manual', due: '2026-11-19T20:59:00.000Z' });
    updateDuty(d.id, { status: 'done' }, NOW);
    expect(state.duties[0]).toMatchObject({ status: 'done' });
    expect(state.duties[0].closedAt).toBeDefined();
    expect(() => updateDuty(d.id, { status: 'blocked' }, NOW)).toThrow(/done or cancelled/);
    // a new date opens it again and starts the reminders over
    state.duties[0].reminders = [{ at: NOW.toISOString(), n: 1, text: 'x' }];
    updateDuty(d.id, { due: '2026-11-25' }, NOW);
    expect(state.duties[0]).toMatchObject({ status: 'open', reminders: [] });
  });

  it('are cancelled when the person is removed', () => {
    const t = addTeam('ناجز');
    saveMember({ phone: '0501111111', name: 'أحمد', teamIds: [t.id] });
    createDuty({ title: 'a', phone: '0501111111', due: '2026-11-19' }, NOW);
    removeMember('0501111111');
    expect(state.duties[0].status).toBe('cancelled');
  });
});

describe('settings', () => {
  it('keep the hours in order and the alert number a real one', () => {
    expect(() => saveTeamSettings({ fromHour: 22, toHour: 8 })).toThrow(/start before/);
    expect(() => saveTeamSettings({ hoursBetween: 0 })).toThrow(/between 1 and 24/);
    expect(() => saveTeamSettings({ alertPhone: '12' })).toThrow(/phone/);
    const s = saveTeamSettings({ alertPhone: '0509999999', fromHour: 7, toHour: 22, hoursBetween: 3 });
    expect(s).toMatchObject({ alertPhone: '966509999999', fromHour: 7, toHour: 22, hoursBetween: 3 });
    expect(saveTeamSettings({ alertPhone: '' }).alertPhone).toBeUndefined();
  });

  it('keep the courier addresses as plain text and refuse to switch on without a short address', () => {
    expect(() => saveCourier({ enabled: true })).toThrow(/short address/);
    const c = saveCourier({ enabled: true, shortAddress: 'حي النرجس، شارع ١٢<script>', fullDetails: 'الدور الثاني\n\n\n\nالباب الأزرق', doorPhotoPath: '/photos/door.jpg' });
    expect(c.shortAddress).not.toContain('<');
    expect(c.fullDetails).toBe('الدور الثاني\n\nالباب الأزرق');
    expect(c.enabled).toBe(true);
  });
});
