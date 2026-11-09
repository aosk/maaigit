import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { deskId } from './desk.js';
import { appendPrivate } from '../secure-fs.js';

/**
 * A full record of every round, holds included: what the desk knew (prices with their exchange and arrival times,
 * the technical reads, the news and when it was fetched), the limits and the book, exactly what the decision step was
 * given and answered (with the prompt's version), each risk verdict and the order it led to. Kept in one file per
 * month, a line per round, so any round can be reconstructed later without today's prices or asking Claude again.
 */

const SA_DIR = process.env.MAAI_ROUNDS_DIR ?? path.join(config.dataDir, 'stocksmart-rounds');
/** Each desk's rounds in its own folder: Tadawul's where they always were, the US desk's beside it. */
const dirOf = () => (deskId() === 'us' ? `${SA_DIR}-us` : SA_DIR);

export interface RoundRecord {
  roundId: string;
  at: string;
  /** Riyadh trading day. */
  day: string;
  [key: string]: unknown;
}

const fileFor = (day: string) => path.join(dirOf(), `${day.slice(0, 7)}.jsonl`);

export function archiveRound(record: RoundRecord): void {
  try {
    appendPrivate(fileFor(record.day), JSON.stringify(record) + '\n');
  } catch (error) {
    // A round still trades if its record cannot be written, but the log says so.
    console.error(`StockSmart: the round record could not be saved (${(error as Error).message}).`);
  }
}

/** Every round of one trading day (YYYY-MM-DD), oldest first. */
export function roundsOf(day: string): RoundRecord[] {
  let text: string;
  try {
    text = fs.readFileSync(fileFor(day), 'utf8');
  } catch {
    return [];
  }
  const out: RoundRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as RoundRecord;
      if (r.day === day) out.push(r);
    } catch {
      // A half-written last line (a crash mid-write) is skipped; the rest stands.
    }
  }
  return out;
}
