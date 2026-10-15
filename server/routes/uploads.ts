import express, { Router } from 'express';
import { saveUpload } from '../uploads.js';
import { HttpError, text } from './http.js';

export const uploads = Router();

/**
 * A photo or PDF for the assistant, sent as the raw file. It is checked by what it really is, held in memory
 * for the next message, and answered with an id. (Sent raw rather than as JSON so a phone photo is not inflated.)
 */
uploads.post('/uploads', express.raw({ type: () => true, limit: '11mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'No file was sent.');
  let name = '';
  try {
    name = decodeURIComponent(text(req.get('x-filename'), 300));
  } catch {
    name = '';
  }
  res.status(201).json(saveUpload(req.body, name));
});
