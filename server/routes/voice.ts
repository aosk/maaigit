import express, { Router } from 'express';
import { transcribe } from '../stt.js';
import { HttpError, wrap } from './http.js';

export const voice = Router();

/** A recording from the microphone, sent raw. Answers with the words (Arabic and English mixed are fine). */
voice.post('/transcribe', express.raw({ type: () => true, limit: '12mb' }), wrap(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'No recording was sent.');
  res.json({ text: await transcribe(req.body) });
}));
