import fs from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { HealthCheck, HealthLevel, HealthReport } from '../shared/types.js';
import { config } from './config.js';
import { botStatus } from './bot.js';
import { failing, signal, type SignalState } from './signals.js';
import { status } from './status.js';
import { dataIsPersistent } from './storage.js';
import { state } from './store.js';
import { alertHealth } from './notify.js';

/**
 * Reads how every part of MAAI is doing right now: the server itself, the saved data, Claude, the device bot
 * and the automatic replies, Gmail, calendars, Asana, news and notifications. Each part is ok, a warning, a
 * failure, or off (not set up). Nothing here calls an outside service: it reads what the server already saw,
 * so checking costs nothing and can run often.
 */

const startedAt = new Date().toISOString();
/** How long the server takes to get to waiting work (high means it is overloaded). */
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

/** The plan's memory; above 80% of it the server is close to being restarted by the host. */
const MEMORY_MB = Number(process.env.MAAI_MEMORY_MB) || 512;

const ago = (iso?: string) => {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172_800 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86_400)} days ago`;
};

/** A check from the last attempts of one kind of work. */
function fromSignal(id: string, name: string, s: SignalState, what: string): HealthCheck {
  if (!s.lastOk && !s.lastFail) return { id, name, status: 'ok', detail: `No ${what} since the server started.` };
  if (failing(s)) return { id, name, status: 'fail', detail: `Last ${what} failed ${ago(s.lastFail)}: ${s.error}`, fix: s.lastOk ? `It last worked ${ago(s.lastOk)}.` : undefined };
  return { id, name, status: 'ok', detail: `Last ${what} worked ${ago(s.lastOk)}${s.ms ? ` (${(s.ms / 1000).toFixed(1)} s)` : ''}.${s.failures ? ` ${s.failures} failure${s.failures === 1 ? '' : 's'} since the server started.` : ''}` };
}

function server(): HealthCheck {
  const rss = Math.round(process.memoryUsage().rss / 1_048_576);
  const delay = Math.round(loopDelay.percentile(99) / 1e6);
  loopDelay.reset();
  const level: HealthLevel = rss > MEMORY_MB * 0.9 || delay > 2000 ? 'fail' : rss > MEMORY_MB * 0.8 || delay > 500 ? 'warn' : 'ok';
  return {
    id: 'server',
    name: 'Server',
    status: level,
    detail: `Up ${ago(startedAt).replace(' ago', '')}; memory ${rss} of ${MEMORY_MB} MB; slowest response to waiting work ${delay} ms.`,
    fix: level === 'ok' ? undefined : rss > MEMORY_MB * 0.8 ? 'Memory is nearly full: a larger Render plan, or a restart, helps.' : 'The server is slow to respond: something is keeping it busy.',
  };
}

function storage(): HealthCheck {
  const file = path.join(config.dataDir, 'store.json');
  let size: string;
  try {
    size = ` (${Math.round(fs.statSync(file).size / 1024)} KB)`;
  } catch {
    size = '';
  }
  let writable = true;
  try {
    fs.accessSync(config.dataDir, fs.constants.W_OK);
  } catch {
    writable = false;
  }
  const saves = signal('storage');
  if (!writable) return { id: 'storage', name: 'Saved data', status: 'fail', detail: `The data folder ${config.dataDir} cannot be written.`, fix: 'Check the Render disk and MAAI_DATA_DIR.' };
  if (failing(saves)) return { id: 'storage', name: 'Saved data', status: 'fail', detail: `Saving failed ${ago(saves.lastFail)}: ${saves.error}`, fix: 'Changes are kept in memory and retried every 30 s; check the disk is not full.' };
  if (config.production && !dataIsPersistent(config.dataDir)) {
    return { id: 'storage', name: 'Saved data', status: 'fail', detail: 'Not on a persistent disk: every update erases the data.', fix: 'Render → service → Disks → Add Disk (mount path /var/data), and MAAI_DATA_DIR = /var/data.' };
  }
  return { id: 'storage', name: 'Saved data', status: 'ok', detail: `Saved${size}; last save ${ago(saves.lastOk)}.` };
}

function claude(): HealthCheck {
  const info = status();
  if (!info.aiConfigured) return { id: 'claude', name: 'Claude AI', status: 'off', detail: 'No ANTHROPIC_API_KEY: MAAI answers in demo mode.' };
  const check = fromSignal('claude', 'Claude AI', signal('claude'), 'request to Claude');
  if (check.status === 'fail' && /credit/i.test(check.detail)) check.fix = 'Add credit at console.anthropic.com → Billing.';
  else if (check.status === 'fail' && /401|key/i.test(check.detail)) check.fix = 'Check ANTHROPIC_API_KEY in Render → Environment.';
  return check;
}

/** The newest bot version MAAI serves, so an outdated bot shows up. */
function latestBotVersion(): string | undefined {
  try {
    const code = fs.readFileSync(new URL('../device-bot/bot.mjs', import.meta.url), 'utf8');
    return /const VERSION = '([^']+)'/.exec(code)?.[1];
  } catch {
    return undefined;
  }
}

function deviceBot(): HealthCheck[] {
  const bot = botStatus();
  if (!bot.connected) return [{ id: 'bot', name: 'Device bot (WhatsApp)', status: 'off', detail: 'Not connected.' }];
  const seenMs = bot.lastSeen ? Date.now() - Date.parse(bot.lastSeen) : Infinity;
  const latest = latestBotVersion();
  const version = state.bot.version;
  const stuck = state.bot.commands.filter((c) => c.status === 'queued' && Date.now() - Date.parse(c.createdAt) > 5 * 60_000).length;
  const level: HealthLevel = seenMs > 2 * 3_600_000 ? 'fail' : seenMs > 3 * 60_000 || stuck || (latest && version && version !== latest) ? 'warn' : 'ok';
  const notes = [
    `Last heard from ${ago(bot.lastSeen)}`,
    `messages delivered ${ago(bot.lastSync)}`,
    version ? `version ${version}${latest && version !== latest ? ` (newest ${latest})` : ''}` : '',
    bot.waiting ? `${bot.waiting} command(s) waiting${stuck ? `, ${stuck} for over 5 min` : ''}` : '',
    `${bot.contacts} contacts`,
  ].filter(Boolean);
  const checks: HealthCheck[] = [
    {
      id: 'bot',
      name: 'Device bot (WhatsApp)',
      status: level,
      detail: `${notes.join('; ')}.`,
      fix:
        level === 'ok'
          ? undefined
          : seenMs > 3 * 60_000
            ? 'The bot is not running or has no internet: check the window on the computer (npm start), and that the computer is not asleep.'
            : latest && version !== latest
              ? 'An update is waiting: it installs itself within 15 minutes when the bot runs with "npm start".'
              : 'Commands are not being collected: restart the bot.',
    },
  ];
  const replies = signal('replies');
  const replyHealth = fromSignal('replies', 'Automatic WhatsApp replies', replies, 'AI reply');
  if (state.replyMode === 'off') checks.push({ id: 'replies', name: 'Automatic WhatsApp replies', status: 'off', detail: 'Switched off in Settings.' });
  else checks.push({ ...replyHealth, detail: `${state.replyMode === 'smart' ? 'Smart' : 'Fixed note'}. ${replyHealth.detail}`, fix: replyHealth.status === 'fail' ? 'The fixed note was sent instead; check Claude AI above.' : undefined });
  return checks;
}

function connections(): HealthCheck[] {
  const info = status();
  const out: HealthCheck[] = [];
  out.push(info.mail?.inbox ? fromSignal('gmail', 'Gmail', signal('gmail'), 'inbox read') : { id: 'gmail', name: 'Gmail', status: 'off', detail: 'Not connected.' });
  const cal = info.calendar;
  out.push(
    !cal?.configured
      ? { id: 'calendar', name: 'Calendars', status: 'off', detail: 'Not connected.' }
      : cal.error || cal.sources?.some((c) => c.error)
        ? { id: 'calendar', name: 'Calendars', status: 'warn', detail: cal.error ?? `${cal.sources?.filter((c) => c.error).map((c) => c.name).join(', ')} could not be read.`, fix: 'Check the calendar addresses in Render → Environment.' }
        : { id: 'calendar', name: 'Calendars', status: 'ok', detail: `${cal.events} events; read ${ago(cal.lastSync)}.` },
  );
  const asana = info.asana;
  out.push(
    !asana?.configured
      ? { id: 'asana', name: 'Asana', status: 'off', detail: 'Not connected.' }
      : asana.error
        ? { id: 'asana', name: 'Asana', status: 'warn', detail: asana.error, fix: 'Check ASANA_TOKEN.' }
        : { id: 'asana', name: 'Asana', status: 'ok', detail: `${asana.open} open tasks, ${asana.overdue} overdue.` },
  );
  const news = info.news;
  if (news) out.push({ id: 'news', name: 'News', status: news.sourcesOk ? 'ok' : news.updatedAt ? 'warn' : 'ok', detail: news.updatedAt ? `${news.sourcesOk} of ${news.sources} sources read ${ago(news.updatedAt)}.` : 'Not read yet.' });
  const push = signal('push');
  out.push(
    !state.subscriptions.length
      ? { id: 'push', name: 'Notifications', status: 'off', detail: 'No phone has notifications turned on.' }
      : failing(push)
        ? { id: 'push', name: 'Notifications', status: 'warn', detail: `Last notification failed ${ago(push.lastFail)}: ${push.error}`, fix: 'Turn notifications off and on again on the phone.' }
        : { id: 'push', name: 'Notifications', status: 'ok', detail: `${state.subscriptions.length} device(s); last sent ${ago(push.lastOk)}.` },
  );
  return out;
}

const RANK: Record<HealthLevel, number> = { off: 0, ok: 0, warn: 1, fail: 2 };

export function healthReport(): HealthReport {
  const checks = [server(), storage(), claude(), ...deviceBot(), ...connections()];
  const worst = Math.max(...checks.map((c) => RANK[c.status]));
  return {
    status: worst === 2 ? 'fail' : worst === 1 ? 'warn' : 'ok',
    checkedAt: new Date().toISOString(),
    version: process.env.RENDER_GIT_COMMIT?.slice(0, 7),
    startedAt,
    checks,
  };
}

// ---------- Watching ----------

/** The level each check had at the last look, to notice when one breaks or recovers. */
const previous = new Map<string, HealthLevel>();

/**
 * Looks every few minutes and tells the user's phones when a part breaks (and once more when it works
 * again), so a silent device bot or failing Claude is noticed without opening the admin page.
 */
export async function watchHealth(): Promise<void> {
  const report = healthReport();
  for (const check of report.checks) {
    const before = previous.get(check.id);
    previous.set(check.id, check.status);
    // The first look only learns the starting point; a warning alone is not worth a notification.
    if (before === undefined || before === check.status) continue;
    if (check.status === 'fail') {
      await alertHealth(`health:${check.id}:fail:${report.checkedAt}`, (lang) => ({
        title: lang === 'ar' ? `${check.name}: توقف` : `${check.name} stopped working`,
        body: `${check.detail}${check.fix ? ` ${check.fix}` : ''}`.slice(0, 200),
      })).catch(() => {});
    } else if (before === 'fail' && check.status === 'ok') {
      await alertHealth(`health:${check.id}:ok:${report.checkedAt}`, (lang) => ({
        title: lang === 'ar' ? `${check.name}: عاد يعمل` : `${check.name} works again`,
        body: check.detail.slice(0, 200),
      })).catch(() => {});
    }
  }
}

/** Starts watching (online and at home alike); the first look is a minute after start. */
export function startHealthWatch(everyMs = 5 * 60_000): void {
  setTimeout(() => void watchHealth(), 60_000).unref();
  setInterval(() => void watchHealth(), everyMs).unref();
}
