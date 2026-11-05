// The bot's memory of every command, on disk, so a restart can never place an order twice (rule 1).
// One line per change, appended and flushed to disk before the bot moves on; the newest line for a command wins.
import fs from 'node:fs';
import path from 'node:path';

/**
 * States, in order: received → submitting → done (a result to report) → reported.
 * "submitting" left behind by a crash means the order may or may not be at SNB: it is never retried.
 */
export function openLedger(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'commands.jsonl');
  const entries = new Map();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && typeof e.commandId === 'string') entries.set(e.commandId, { ...entries.get(e.commandId), ...e });
      } catch {
        // A half-written last line (power cut): the line before it still holds.
      }
    }
  }
  const fd = fs.openSync(file, 'a');

  function write(commandId, change) {
    const entry = { ...entries.get(commandId), ...change, commandId, at: new Date().toISOString() };
    entries.set(commandId, entry);
    fs.writeSync(fd, JSON.stringify(entry) + '\n');
    fs.fsyncSync(fd);
    return entry;
  }

  return {
    get: (commandId) => entries.get(commandId),
    has: (commandId) => entries.has(commandId),
    write,
    /** Results not yet accepted by the server, to send again. */
    unreported: () => [...entries.values()].filter((e) => e.state === 'done'),
    /** Orders at SNB that have not ended: accepted, or partly filled (their last result reported). */
    resting: () => [...entries.values()].filter((e) => (e.state === 'reported' || e.state === 'done') && (e.result?.status === 'accepted' || e.result?.status === 'partial')),
    /** Commands received but not yet at Submit when the bot stopped. */
    pending: () => [...entries.values()].filter((e) => e.state === 'received'),
    /** Commands a crash interrupted mid-submission. */
    interrupted: () => [...entries.values()].filter((e) => e.state === 'submitting'),
    close: () => fs.closeSync(fd),
  };
}
