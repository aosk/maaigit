import { Router } from 'express';
import { findContacts } from '../contacts.js';
import { state } from '../store.js';
import { TeamError, addTeam, createDuty, removeMember, removeTeam, saveCourier, saveMember, saveTeamSettings, teamsView, updateDuty, updateTeam } from '../teams.js';
import { HttpError, wrap } from './http.js';

/** Teams, the people in them, what they owe, and how delivery couriers are answered. */
export const teams = Router();

/** A rule of the teams module broken by what was sent: shown to the user as it is. */
const run = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (error) {
    if (error instanceof TeamError) throw new HttpError(400, error.message);
    throw error;
  }
};

teams.get('/teams', (_req, res) => res.json(teamsView()));
teams.post('/teams', (req, res) => res.status(201).json(run(() => addTeam(req.body?.name))));
teams.patch('/teams/:id', (req, res) => res.json(run(() => updateTeam(req.params.id, req.body ?? {}))));
teams.delete('/teams/:id', (req, res) => {
  run(() => removeTeam(req.params.id));
  res.status(204).end();
});

teams.put('/team-members', (req, res) => res.json(run(() => saveMember(req.body ?? {}))));
teams.delete('/team-members/:phone', (req, res) => {
  run(() => removeMember(req.params.phone));
  res.status(204).end();
});
/** Finds someone in the user's contacts by name, to add to a team. */
teams.get('/team-contacts', (req, res) => res.json(findContacts(typeof req.query.q === 'string' ? req.query.q : '', 8)));

teams.post('/duties', (req, res) => res.status(201).json(run(() => createDuty({ ...(req.body ?? {}), source: 'manual' }))));
teams.patch('/duties/:id', (req, res) => res.json(run(() => updateDuty(req.params.id, req.body ?? {}))));

teams.put('/team-settings', (req, res) => res.json(run(() => saveTeamSettings(req.body ?? {}))));

teams.get('/courier', wrap((_req, res) => res.json({ settings: state.courier, log: state.courierLog.slice(-50).reverse() })));
teams.put('/courier', (req, res) => res.json(run(() => saveCourier(req.body ?? {}))));
