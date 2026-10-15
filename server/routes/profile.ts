import { Router } from 'express';
import { addFact, deleteFact, forgetEverything, profileInfo, setEnabled, updateFact } from '../profile.js';
import { HttpError, wrap } from './http.js';

export const profile = Router();

/** What MAAI knows about the user, for the "What MAAI knows about me" screen in Settings. */
profile.get('/profile', (_req, res) => res.json(profileInfo()));

profile.post('/profile/facts', wrap((req, res) => {
  res.status(201).json(addFact({ text: req.body?.text, category: req.body?.category, pinned: req.body?.pinned, source: 'user' }));
}));

profile.patch('/profile/facts/:id', wrap((req, res) => {
  res.json(updateFact(req.params.id, { text: req.body?.text, category: req.body?.category, pinned: req.body?.pinned }));
}));

profile.delete('/profile/facts/:id', wrap((req, res) => {
  deleteFact(req.params.id);
  res.status(204).end();
}));

/** Switches the use of the profile on or off without deleting anything. */
profile.put('/profile/enabled', wrap((req, res) => {
  if (typeof req.body?.enabled !== 'boolean') throw new HttpError(400, 'Say whether to use the profile.');
  setEnabled(req.body.enabled);
  res.json(profileInfo());
}));

/** A copy of everything, to keep. */
profile.get('/profile/export', (_req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="maai-profile.json"');
  res.json({ exportedAt: new Date().toISOString(), ...profileInfo() });
});

/** Forgets everything. The app asks for confirmation first. */
profile.delete('/profile', (_req, res) => {
  forgetEverything();
  res.status(204).end();
});
