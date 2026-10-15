import { Router } from 'express';
import { newsDigest } from '../ai/news.js';
import { newsEnabled, refreshNews } from '../news/index.js';
import { HttpError, lang, wrap } from './http.js';

export const news = Router();

/** The news section: the top stories for AI and technology, and for Saudi Arabia. */
news.get('/news', wrap(async (req, res) => res.json(await newsDigest(lang(req.query.lang)))));

/** Reads the sources again now (at most once every 5 minutes), then answers with the new digest. */
news.post('/news/refresh', wrap(async (req, res) => {
  if (!newsEnabled) throw new HttpError(503, 'The news section is switched off.');
  await refreshNews({ minAgeMs: 5 * 60_000 });
  res.json(await newsDigest(lang(req.body?.lang)));
}));
