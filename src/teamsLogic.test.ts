import { describe, expect, it } from 'vitest';
import type { Duty, Team, TeamMember } from '../shared/types';
import { dueFromInput, dueText, groupByTeam, hoursOk, inputFromDue, langChoice, langOk, memberLang, phoneOk, plusDigits, splitDuties, toggleDay } from './teamsLogic';

const teams: Team[] = [{ id: 'a', name: 'Najiz', offDays: [5, 6] }, { id: 'b', name: 'Lawyers', offDays: [5, 6] }];
const members: TeamMember[] = [
  { phone: '966501234567', name: 'Zaid', teamIds: ['a'], lang: 'ar' },
  { phone: '966507654321', name: 'Amal', teamIds: ['a', 'b'], lang: 'en' },
];
const duty = (over: Partial<Duty>): Duty => ({ id: 'x', title: 't', phone: '1', name: 'n', due: '2026-11-20T10:00:00.000Z', status: 'open', createdAt: '', reminders: [], replies: [], source: 'manual', ...over });

describe('teams logic', () => {
  it('groups people under every team they follow', () => {
    const g = groupByTeam(teams, members);
    expect(g[0]?.members.map((m) => m.name)).toEqual(['Amal', 'Zaid']);
    expect(g[1]?.members.map((m) => m.name)).toEqual(['Amal']);
  });
  it('splits open from finished follow-ups', () => {
    const s = splitDuties([duty({ id: '1', due: '2026-12-01T00:00:00Z' }), duty({ id: '2', due: '2026-11-01T00:00:00Z', status: 'blocked' }), duty({ id: '3', status: 'done' }), duty({ id: '4', status: 'cancelled' })]);
    expect(s.open.map((d) => d.id)).toEqual(['2', '1']);
    expect(s.finished.map((d) => d.id).sort()).toEqual(['3', '4']);
  });
  it('writes the due time in Riyadh time with today and tomorrow', () => {
    const now = new Date('2026-11-16T08:00:00Z');
    const words = { today: 'Today', tomorrow: 'Tomorrow' };
    expect(dueText('2026-11-16T15:30:00Z', 'en', words, now)).toBe('Today 18:30');
    expect(dueText('2026-11-17T06:00:00Z', 'en', words, now)).toBe('Tomorrow 9:00');
    expect(dueText('2026-11-21T06:00:00Z', 'en', words, now)).toContain('21');
    // 22:00 UTC is already the next day in Riyadh.
    expect(dueText('2026-11-16T22:00:00Z', 'en', words, now)).toMatch(/^Tomorrow/);
  });
  it('turns the date box into a Riyadh moment and back', () => {
    expect(dueFromInput('2026-11-20T18:00')).toBe('2026-11-20T15:00:00.000Z');
    expect(dueFromInput('2026-11-20')).toBe('2026-11-20T20:59:00.000Z');
    expect(dueFromInput('soon')).toBe('');
    expect(inputFromDue('2026-11-20T15:00:00.000Z')).toBe('2026-11-20T18:00');
  });
  it('toggles days off', () => {
    expect(toggleDay([5, 6], 5)).toEqual([6]);
    expect(toggleDay([5, 6], 0)).toEqual([0, 5, 6]);
  });
  it('checks phones, languages and hours', () => {
    expect(phoneOk('0501234567')).toBe(true);
    expect(phoneOk('12')).toBe(false);
    expect(langOk('fr')).toBe(true);
    expect(langOk('f')).toBe(false);
    expect(langOk('abcdefghi')).toBe(false);
    expect(langOk('ur2')).toBe(false);
    expect(hoursOk(9, 20)).toBe(true);
    expect(hoursOk(20, 9)).toBe(false);
    expect(hoursOk(9, 24)).toBe(false);
  });
  it('maps languages both ways', () => {
    expect(memberLang('other', ' FR ')).toBe('fr');
    expect(memberLang('en', 'x')).toBe('en');
    expect(langChoice('ur')).toBe('other');
    expect(langChoice('ar')).toBe('ar');
    expect(plusDigits('966501234567')).toBe('+966501234567');
  });
});
