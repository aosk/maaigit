import express, { Router } from 'express';
import { clearCards, contactCount, importCards } from '../contacts.js';
import { HttpError } from './http.js';

export const contacts = Router();

contacts.get('/contacts', (_req, res) => res.json(contactCount()));

// The browser reads the file and sends only names, numbers, emails and companies, as JSON sent as plain text
// (a few thousand contacts can be larger than the 1 MB the rest of the app accepts).
contacts.post('/contacts/import', express.text({ type: 'text/plain', limit: '4mb' }), (req, res) => {
  let cards: unknown;
  try {
    cards = JSON.parse(typeof req.body === 'string' ? req.body : '');
  } catch {
    throw new HttpError(400, 'The contacts could not be read.');
  }
  importCards(cards);
  res.json(contactCount());
});

contacts.delete('/contacts', (_req, res) => {
  clearCards();
  res.json(contactCount());
});
