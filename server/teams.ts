import type { CourierSettings, Duty, Team, TeamMember, TeamSettings, TeamsView } from '../shared/types.js';
import { stripInvisible } from './ai/untrusted.js';
import { audit, id, save, state } from './store.js';

/**
 * Teams: the people the user follows up with, what each owes by when, and the settings that decide how MAAI reminds
 * them. This file is the data and its rules (add, change, remove, check); the reminders themselves are sent by
 * server/team-reminders.ts and their answers are read by server/team-replies.ts.
 */

export class TeamError extends Error {}

const MAX_TEAMS = 20;
const MAX_MEMBERS = 300;
const MAX_OPEN_DUTIES = 500;
/** Finished duties are kept this long (for the log), then forgotten. */
const KEEP_CLOSED_DAYS = 90;

/** A name or a title: one visible line, no markup, at most `max` characters. */
const line = (value: unknown, max: number): string =>
  typeof value === 'string' ? stripInvisible(value).replace(/[\p{Cc}<>]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** A few lines of text (a short address with its details): line breaks kept, nothing hidden or executable. */
const block = (value: unknown, max: number): string =>
  typeof value === 'string' ? stripInvisible(value).replace(/\r/g, '').replace(/[^\S\n]+/g, ' ').replace(/[\p{Cc}<>]/gu, (c) => (c === '\n' ? '\n' : ' ')).replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '';

/** A phone number as WhatsApp wants it: digits, with a Saudi mobile written the local way (05XXXXXXXX) made international. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let digits = String(raw).replace(/\D/g, '');
  if (/^05\d{8}$/.test(digits)) digits = `966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) digits = `966${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

// ---------- The view ----------

export function teamsView(): TeamsView {
  return { teams: state.teams, members: state.teamMembers, duties: state.duties, settings: state.teamSettings };
}

// ---------- Teams ----------

const days = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) return null;
  const set = [...new Set(value.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))];
  return set.length === value.length ? set.sort() : null;
};

export function addTeam(name: unknown): Team {
  const clean = line(name, 60);
  if (!clean) throw new TeamError('Give the team a name.');
  if (state.teams.length >= MAX_TEAMS) throw new TeamError(`At most ${MAX_TEAMS} teams.`);
  if (state.teams.some((t) => t.name === clean)) throw new TeamError('There is a team with this name already.');
  const team: Team = { id: id(), name: clean, offDays: [5, 6] };
  state.teams.push(team);
  audit(`Team added: ${clean}`, 'User', 'done');
  save();
  return team;
}

export function updateTeam(teamId: string, patch: { name?: unknown; offDays?: unknown }): Team {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) throw new TeamError('No such team.');
  if (patch.name !== undefined) {
    const clean = line(patch.name, 60);
    if (!clean) throw new TeamError('Give the team a name.');
    if (state.teams.some((t) => t.id !== teamId && t.name === clean)) throw new TeamError('There is a team with this name already.');
    team.name = clean;
  }
  if (patch.offDays !== undefined) {
    const off = days(patch.offDays);
    if (!off) throw new TeamError('Days off are numbers from 0 (Sunday) to 6 (Saturday).');
    team.offDays = off;
  }
  save();
  return team;
}

export function removeTeam(teamId: string): void {
  if (!state.teams.some((t) => t.id === teamId)) throw new TeamError('No such team.');
  state.teams = state.teams.filter((t) => t.id !== teamId);
  for (const m of state.teamMembers) m.teamIds = m.teamIds.filter((x) => x !== teamId);
  for (const d of state.duties) if (d.teamId === teamId) d.teamId = undefined;
  audit('Team removed', 'User', 'done');
  save();
}

// ---------- Members ----------

/** Adds a person to the teams (or changes which ones, or their language). A person in no team is removed. */
export function saveMember(input: { phone?: unknown; name?: unknown; teamIds?: unknown; lang?: unknown }): TeamMember {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new TeamError('That phone number does not look right.');
  const name = line(input.name, 80);
  if (!name) throw new TeamError('Give the person a name.');
  const ids = Array.isArray(input.teamIds) ? [...new Set(input.teamIds.filter((x): x is string => typeof x === 'string'))] : [];
  if (!ids.length) throw new TeamError('Choose at least one team.');
  if (ids.some((x) => !state.teams.some((t) => t.id === x))) throw new TeamError('One of the teams does not exist.');
  const lang = input.lang === 'en' || input.lang === 'ar' ? input.lang : line(input.lang, 8).toLowerCase() || 'ar';
  const existing = state.teamMembers.find((m) => m.phone === phone);
  if (!existing && state.teamMembers.length >= MAX_MEMBERS) throw new TeamError(`At most ${MAX_MEMBERS} people.`);
  const member: TeamMember = { phone, name, teamIds: ids, lang };
  if (existing) Object.assign(existing, member);
  else state.teamMembers.push(member);
  audit(`Team member saved: ${name}`, 'User', 'done');
  save();
  return existing ?? member;
}

export function removeMember(phone: string): void {
  const p = normalizePhone(phone);
  if (!p || !state.teamMembers.some((m) => m.phone === p)) throw new TeamError('No such person.');
  state.teamMembers = state.teamMembers.filter((m) => m.phone !== p);
  const now = new Date().toISOString();
  for (const d of state.duties) if (d.phone === p && (d.status === 'open' || d.status === 'acknowledged' || d.status === 'blocked')) Object.assign(d, { status: 'cancelled', closedAt: now });
  audit('Team member removed', 'User', 'done');
  save();
}

/** The member with this number, if any. */
const memberOf = (phone: string): TeamMember | undefined => state.teamMembers.find((m) => m.phone === phone);

// ---------- Duties ----------

const isOpen = (d: Duty) => d.status === 'open' || d.status === 'acknowledged' || d.status === 'blocked';
const openDuties = (): Duty[] => state.duties.filter(isOpen);

/** A date the user or the assistant gave: an ISO time, or a plain date (taken as the end of that day, Riyadh time). */
function parseDue(value: unknown, now: Date): string {
  if (typeof value !== 'string' || !value.trim()) throw new TeamError('Give a due date.');
  const text = value.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T23:59:00+03:00` : text;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) throw new TeamError('That date does not look right.');
  if (at < now.getTime() - 3_600_000) throw new TeamError('That date has passed.');
  if (at > now.getTime() + 2 * 365 * 86_400_000) throw new TeamError('That date is too far away.');
  return new Date(at).toISOString();
}

export function createDuty(input: { title?: unknown; phone?: unknown; due?: unknown; teamId?: unknown; source?: 'manual' | 'assistant' }, now = new Date()): Duty {
  const title = line(input.title, 160);
  if (!title) throw new TeamError('Say what it is.');
  const phone = normalizePhone(input.phone);
  const member = phone ? memberOf(phone) : undefined;
  if (!phone || !member) throw new TeamError('That person is not in any team yet: add them first.');
  const teamId = typeof input.teamId === 'string' && member.teamIds.includes(input.teamId) ? input.teamId : member.teamIds[0];
  if (openDuties().length >= MAX_OPEN_DUTIES) throw new TeamError(`At most ${MAX_OPEN_DUTIES} open items.`);
  const duty: Duty = { id: id(), title, phone, name: member.name, teamId, due: parseDue(input.due, now), status: 'open', createdAt: now.toISOString(), reminders: [], replies: [], source: input.source ?? 'manual' };
  state.duties.push(duty);
  // Finished ones past their keeping time are let go.
  const cutoff = new Date(now.getTime() - KEEP_CLOSED_DAYS * 86_400_000).toISOString();
  state.duties = state.duties.filter((d) => isOpen(d) || (d.closedAt ?? d.createdAt) >= cutoff);
  audit(`Follow-up created for ${member.name}: ${title}`, input.source === 'assistant' ? 'MAAI' : 'User', 'done');
  save();
  return duty;
}

/** The user's own changes: mark it done or drop it, or move its date (which opens it again and starts the reminders over). */
export function updateDuty(dutyId: string, patch: { status?: unknown; due?: unknown }, now = new Date()): Duty {
  const duty = state.duties.find((d) => d.id === dutyId);
  if (!duty) throw new TeamError('No such item.');
  if (patch.status !== undefined) {
    if (patch.status !== 'done' && patch.status !== 'cancelled') throw new TeamError('You can mark an item done or cancelled.');
    duty.status = patch.status;
    duty.closedAt = now.toISOString();
  }
  if (patch.due !== undefined) {
    duty.due = parseDue(patch.due, now);
    duty.status = 'open';
    duty.closedAt = undefined;
    duty.escalatedAt = undefined;
    duty.reminders = [];
  }
  save();
  return duty;
}

// ---------- Settings ----------

export function saveTeamSettings(patch: Partial<Record<keyof TeamSettings, unknown>>): TeamSettings {
  const s = state.teamSettings;
  if (patch.enabled !== undefined) s.enabled = patch.enabled === true;
  if (patch.alertPhone !== undefined) {
    if (patch.alertPhone === '' || patch.alertPhone === null) s.alertPhone = undefined;
    else {
      const p = normalizePhone(patch.alertPhone);
      if (!p) throw new TeamError('That phone number does not look right.');
      s.alertPhone = p;
    }
  }
  const hour = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23 ? v : null);
  const from = patch.fromHour !== undefined ? hour(patch.fromHour) : s.fromHour;
  const to = patch.toHour !== undefined ? hour(patch.toHour) : s.toHour;
  if (from === null || to === null || from >= to) throw new TeamError('The sending hours must start before they end (0 to 23).');
  s.fromHour = from;
  s.toHour = to;
  if (patch.hoursBetween !== undefined) {
    const h = patch.hoursBetween;
    if (typeof h !== 'number' || !Number.isInteger(h) || h < 1 || h > 24) throw new TeamError('Wait between 1 and 24 hours between reminders.');
    s.hoursBetween = h;
  }
  audit('Team reminder settings changed', 'User', 'done');
  save();
  return s;
}

export function saveCourier(patch: Partial<Record<keyof CourierSettings, unknown>>): CourierSettings {
  const c = state.courier;
  if (patch.enabled !== undefined) c.enabled = patch.enabled === true;
  if (patch.shortAddress !== undefined) c.shortAddress = block(patch.shortAddress, 240);
  if (patch.fullDetails !== undefined) c.fullDetails = block(patch.fullDetails, 600);
  if (patch.doorPhotoPath !== undefined) c.doorPhotoPath = line(patch.doorPhotoPath, 400);
  if (c.enabled && !c.shortAddress) throw new TeamError('Write the short address before turning this on.');
  audit(`Courier replies ${c.enabled ? 'on' : 'off'}`, 'User', 'done');
  save();
  return c;
}
