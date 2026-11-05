// The StockSmart side of the SNB bot: fetching commands, checking them, asking before submitting, reporting back.
// Everything SNB-specific (its screens) lives in a broker (brokers/*.mjs); this file never touches the browser.
//
// The rules from docs/stocksmart-bot.md, and where each one is kept:
//   1 never place twice ............ the ledger on disk; a known commandId is acknowledged again and skipped
//   2 signature and expiry ......... verify() before anything, expiry against the server's clock
//   3 ask before Submit ............ beforeSubmit() → GET /go/:commandId, given to the broker to call last
//   4 compare the confirmation ..... sameOrder(), for the broker to call on the confirmation screen
//   5 unknown screen = stop ........ any broker error is reported "failed", never retried; a crash mid-submit too
//   6 screenshot every submission .. the broker saves it; its path goes in the ledger
//   7 dead-man switch .............. nothing is submitted when the server has not answered for 3 minutes
//   8 report the account ........... POST /positions every few minutes, from the broker's portfolio screen
//   9 heartbeat .................... POST /heartbeat every minute, logged in or not
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEAD_MAN_MS = 3 * 60_000;
const HEARTBEAT_MS = 60_000;
const POSITIONS_MS = 5 * 60_000;
/** How often an order resting at SNB (accepted, or partly filled) is looked up again. */
const FOLLOW_MS = 30_000;
const RESULTS = ['accepted', 'filled', 'partial', 'cancelled', 'rejected', 'failed', 'unknown'];
/** The results after which nothing more can happen to an order at SNB. */
const FINAL = ['filled', 'cancelled', 'rejected', 'failed'];
const REQUEST_TIMEOUT_MS = 40_000;

/** The signature StockSmart puts on each command (HMAC-SHA256 of its fields with the signing secret). */
export function signature(cmd, secret) {
  const text = [cmd.commandId, cmd.symbol, cmd.side, cmd.qty, Number(cmd.limitPrice).toFixed(2), cmd.issuedAt, cmd.expiresAt].join('|');
  return createHmac('sha256', secret).update(text).digest('hex');
}

/** Rule 2: a command is placed only if it is well formed, signed by StockSmart, and not expired. */
export function verify(cmd, secret, nowMs) {
  if (!cmd || typeof cmd !== 'object') return 'not a command';
  if (!/^ord_[0-9a-f]{16}$/.test(cmd.commandId ?? '')) return 'bad command id';
  if (!/^\d{4}$/.test(cmd.symbol ?? '')) return 'bad symbol';
  if (cmd.side !== 'buy' && cmd.side !== 'sell') return 'bad side';
  if (!Number.isInteger(cmd.qty) || cmd.qty <= 0) return 'bad quantity';
  if (!(Number(cmd.limitPrice) > 0)) return 'bad price';
  const expires = Date.parse(cmd.expiresAt);
  if (!Number.isFinite(expires) || !Number.isFinite(Date.parse(cmd.issuedAt))) return 'bad times';
  const given = Buffer.from(String(cmd.sig ?? ''), 'hex');
  const wanted = Buffer.from(signature(cmd, secret), 'hex');
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return 'signature does not match';
  if (nowMs >= expires) return 'expired';
  return '';
}

/** Rule 4: what the broker's confirmation screen shows must be exactly the command (price to the halala). */
export function sameOrder(cmd, shown) {
  return (
    String(shown?.symbol) === cmd.symbol &&
    shown?.side === cmd.side &&
    Number(shown?.qty) === cmd.qty &&
    Math.round(Number(shown?.limitPrice) * 100) === Math.round(Number(cmd.limitPrice) * 100)
  );
}

/**
 * The bot. `broker` is the SNB part (see brokers/README in the bot's README):
 *   practice: boolean                      true when it places nothing
 *   session(): { loggedIn, expiresInSec? }
 *   quotes(): [{ symbol, price, prevClose }]   may be []
 *   account(): { cash, positions: [{ symbol, qty, avgCost }] } | null   null when it cannot read it
 *   place(cmd, { beforeSubmit, sameOrder, progress }): { status, filledQty?, avgPrice?, brokerOrderId?, error?, screenshot? }
 * place() must call `await beforeSubmit()` as the very last thing before pressing Submit, and press nothing if it
 * returns false.
 */
export function createBot({ url, key, secret, broker, ledger, log = console.log, fetchImpl = fetch, now = () => Date.now() }) {
  const base = url.replace(/\/+$/, '') + '/trade/v1';
  let lastOk = 0;
  let clockOffset = 0; // server time minus ours, so expiry is judged by StockSmart's clock
  let halted = false;
  let mode = 'paper';
  let stopped = false;
  let busy = Promise.resolve();
  const timers = [];
  const inflight = new Set();

  const serverNow = () => now() + clockOffset;
  const deadManTripped = () => now() - lastOk > DEAD_MAN_MS;

  async function call(method, path, body) {
    const controller = new AbortController();
    inflight.add(controller);
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetchImpl(base + path, {
        method,
        headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 404) {
        // 404 on every path means StockSmart has no bot key any more (revoked); 401, a wrong key.
        const err = new Error(res.status === 401 ? 'StockSmart refused the bot key (wrong key, or a new one was made).' : 'StockSmart has no bot connected (the key was revoked).');
        err.fatal = path === '/heartbeat';
        err.status = res.status;
        throw err;
      }
      if (res.status === 429) throw new Error('StockSmart says slow down (too many requests).');
      if (res.status >= 400) throw new Error(`StockSmart answered ${res.status} to ${path}.`);
      lastOk = now();
      const data = res.status === 204 ? null : await res.json().catch(() => null);
      if (data && typeof data.serverTime === 'string') {
        const t = Date.parse(data.serverTime);
        if (Number.isFinite(t)) clockOffset = t - now();
      }
      if (data && typeof data.halted === 'boolean') halted = data.halted;
      if (data && typeof data.mode === 'string') mode = data.mode;
      return data;
    } finally {
      clearTimeout(timer);
      inflight.delete(controller);
    }
  }

  /** A result is kept in the ledger until StockSmart accepts it, then marked reported. */
  async function report(commandId, result) {
    ledger.write(commandId, { state: 'done', result });
    try {
      await call('POST', '/result', { commandId, ...result });
      ledger.write(commandId, { state: 'reported' });
    } catch (error) {
      if (error.status === 404) ledger.write(commandId, { state: 'reported', note: 'StockSmart no longer knows this command' });
      else log(`! Could not report ${commandId} yet (${error.message}); will send it again.`);
    }
  }

  async function progress(commandId, stage) {
    try {
      await call('POST', '/progress', { commandId, stage });
    } catch {
      // Progress is a courtesy; the result is what counts.
    }
  }

  /** Rule 3 (and 2, 7 once more): the last check, made by the broker right before it presses Submit. */
  async function beforeSubmit(cmd) {
    if (stopped) return false;
    if (deadManTripped()) {
      log(`! Not submitting ${cmd.commandId}: StockSmart has not answered for 3 minutes.`);
      return false;
    }
    if (serverNow() >= Date.parse(cmd.expiresAt)) {
      log(`! Not submitting ${cmd.commandId}: it expired.`);
      return false;
    }
    let answer;
    try {
      answer = await call('GET', `/go/${cmd.commandId}`);
    } catch (error) {
      log(`! Not submitting ${cmd.commandId}: could not ask StockSmart (${error.message}).`);
      return false;
    }
    if (!answer?.go) {
      log(`! Not submitting ${cmd.commandId}: StockSmart says no (${answer?.reason ?? 'no reason'}).`);
      return false;
    }
    // From here the order may reach SNB: a crash after this line must never lead to a second try.
    ledger.write(cmd.commandId, { state: 'submitting' });
    return true;
  }

  async function handle(cmd) {
    const id = typeof cmd?.commandId === 'string' ? cmd.commandId : '';
    if (id && ledger.has(id)) {
      // Rule 1: seen before (StockSmart sends again until it hears "received"). Say it again, do nothing else.
      await call('POST', '/ack', { commandId: id }).catch(() => {});
      return;
    }
    const problem = verify(cmd, secret, serverNow());
    if (!/^ord_[0-9a-f]{16}$/.test(id)) {
      log(`! Ignored something that is not a command (${problem}).`);
      return;
    }
    ledger.write(id, { state: 'received', cmd: { symbol: cmd.symbol, side: cmd.side, qty: cmd.qty, limitPrice: cmd.limitPrice, expiresAt: cmd.expiresAt } });
    await call('POST', '/ack', { commandId: id }).catch((e) => log(`! Could not acknowledge ${id} (${e.message}).`));
    if (problem) {
      log(`✗ ${id}: ${problem}. Not placed.`);
      await report(id, { status: 'failed', error: `The bot refused it: ${problem}.` });
      return;
    }
    log(`→ ${id}: ${cmd.side} ${cmd.qty} × ${cmd.symbol} at ${Number(cmd.limitPrice).toFixed(2)} (until ${new Date(cmd.expiresAt).toLocaleTimeString()})`);
    let result;
    try {
      result = await broker.place(cmd, { beforeSubmit: () => beforeSubmit(cmd), sameOrder: (shown) => sameOrder(cmd, shown), progress: (stage) => progress(id, stage) });
    } catch (error) {
      // Rule 5: an unexpected screen or error is a stop, never a retry. After Submit, SNB may have the order.
      const submitted = ledger.get(id)?.state === 'submitting';
      result = { status: submitted ? 'unknown' : 'failed', error: `The bot stopped${submitted ? ' after Submit' : ''}: ${error?.message ?? error}` };
    }
    // After Submit only the broker knows: a result the broker part cannot give is "unknown", never "failed" (which
    // would tell StockSmart the order never reached SNB, and free its cash and stock).
    const submitted = ledger.get(id)?.state === 'submitting';
    if (!result || !RESULTS.includes(result.status)) result = { status: submitted ? 'unknown' : 'failed', error: 'The broker part gave no clear result.' };
    if (submitted && result.status === 'failed' && !result.beforeSubmit) result = { ...result, status: 'unknown' };
    if (result.screenshot) ledger.write(id, { screenshot: result.screenshot });
    const { screenshot: _s, beforeSubmit: _b, ...sent } = result;
    log(`${sent.status === 'filled' || sent.status === 'partial' ? '✓' : '✗'} ${id}: ${sent.status}${sent.filledQty ? ` ${sent.filledQty} at ${sent.avgPrice}` : ''}${sent.error ? ` — ${sent.error}` : ''}`);
    await report(id, sent);
  }

  /** After a restart: results StockSmart has not heard yet, and commands a crash cut off. */
  async function recover() {
    for (const e of ledger.unreported()) await report(e.commandId, e.result);
    for (const e of ledger.interrupted()) {
      log(`! ${e.commandId} was being submitted when the bot stopped. It is not tried again: check it in the SNB app.`);
      await report(e.commandId, { status: 'unknown', error: 'The bot stopped while submitting this order; it may be at SNB. Check the SNB app.' });
    }
    // Received but the bot stopped before it got to Submit: nothing reached SNB, and it is not picked up again.
    for (const e of ledger.pending()) await report(e.commandId, { status: 'failed', error: 'The bot restarted before placing this order. It was not placed.' });
  }

  /**
   * A cancel from StockSmart (Stop, or the order expired while resting at SNB). Checked like a command; an order the
   * bot never received is noted so it can never be placed later; one that reached SNB and is not finished is
   * cancelled there. A cancel the broker part cannot confirm is "unknown": the order might still fill.
   */
  async function handleCancel(c) {
    const id = typeof c?.commandId === 'string' && /^ord_[0-9a-f]{16}$/.test(c.commandId) ? c.commandId : '';
    if (!id) return;
    const wanted = createHmac('sha256', secret).update(['cancel', id, String(c.issuedAt)].join('|')).digest('hex');
    const given = Buffer.from(String(c.sig ?? ''), 'hex');
    if (given.length !== 32 || !timingSafeEqual(given, Buffer.from(wanted, 'hex'))) {
      log(`! Ignored a cancel for ${id}: its signature does not match.`);
      return;
    }
    const entry = ledger.get(id);
    await call('POST', '/ack', { commandId: id, kind: 'cancel' }).catch(() => {});
    if (!entry) {
      // Never received: noted, so the order itself is refused if it ever arrives.
      ledger.write(id, { state: 'done', result: { status: 'cancelled' }, note: 'cancelled before it arrived' });
      await report(id, { status: 'cancelled' });
      return;
    }
    const last = entry.result?.status;
    if (last && FINAL.includes(last)) return; // nothing left to cancel at SNB
    log(`✗ Cancelling ${id} at SNB (${entry.result?.brokerOrderId ?? 'no SNB number yet'}).`);
    let result;
    try {
      result = broker.cancel ? await broker.cancel({ commandId: id, ...entry.cmd }, entry.result ?? {}) : { status: 'unknown', error: 'This broker part cannot cancel.' };
    } catch (error) {
      result = { status: 'unknown', error: `Cancelling failed: ${error?.message ?? error}` };
    }
    if (!result || !RESULTS.includes(result.status)) result = { status: 'unknown', error: 'The cancel could not be confirmed.' };
    await report(id, result);
  }

  /** Orders resting at SNB are looked up until they end (filled, cancelled, rejected), and each change reported. */
  async function follow() {
    if (!broker.orderStatus) return;
    for (const e of ledger.resting()) {
      const now = await broker.orderStatus({ commandId: e.commandId, ...e.cmd }, e.result ?? {});
      if (now && RESULTS.includes(now.status) && (now.status !== e.result?.status || now.filledQty !== e.result?.filledQty)) await report(e.commandId, now);
    }
  }

  async function heartbeat() {
    let session = { loggedIn: false };
    let quotes = [];
    try {
      session = (await broker.session()) ?? session;
      quotes = session.loggedIn ? ((await broker.quotes()) ?? []) : [];
    } catch (error) {
      log(`! Could not read the SNB session (${error.message}).`);
    }
    await call('POST', '/heartbeat', { brokerSession: Boolean(session.loggedIn), expiresInSec: session.expiresInSec, practice: Boolean(broker.practice), quotes: quotes.slice(0, 50) });
  }

  async function positions() {
    const account = await broker.account();
    if (!account) return;
    const answer = await call('POST', '/positions', account);
    if (answer?.drift) log('! Your SNB account differs from what StockSmart expected: StockSmart stopped trading. Check it in the app.');
  }

  /** Runs `job` every `ms`, never two at once, logging failures (a fatal one stops the bot). */
  function every(ms, name, job) {
    let running = false;
    const tick = async () => {
      if (running || stopped) return;
      running = true;
      try {
        await job();
      } catch (error) {
        log(`! ${name}: ${error.message}`);
        if (error.fatal) stop(error.message);
      } finally {
        running = false;
      }
    };
    void tick();
    timers.push(setInterval(tick, ms));
  }

  async function pollLoop() {
    while (!stopped) {
      try {
        const data = await call('GET', '/commands?wait=25');
        for (const cmd of data?.commands ?? []) {
          // One order at a time, in the order they came.
          busy = busy.then(() => handle(cmd)).catch((e) => log(`! ${e.message}`));
          await busy;
        }
        for (const c of data?.cancels ?? []) {
          // After any order in progress, so a cancel never races its own order.
          busy = busy.then(() => handleCancel(c)).catch((e) => log(`! ${e.message}`));
          await busy;
        }
      } catch (error) {
        if (stopped) break;
        log(`! Fetching commands: ${error.message}`);
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  }

  let onStop = () => {};
  function stop(reason) {
    if (stopped) return;
    stopped = true;
    for (const t of timers) clearInterval(t);
    for (const c of inflight) c.abort();
    if (reason) log(`■ Stopped: ${reason}`);
    onStop(reason);
  }

  return {
    /** Starts everything; resolves when the bot stops. */
    async run() {
      const done = new Promise((resolve) => (onStop = resolve));
      await recover().catch((e) => log(`! Recovering: ${e.message}`));
      every(HEARTBEAT_MS, 'Heartbeat', heartbeat);
      every(POSITIONS_MS, 'Account report', positions);
      every(FOLLOW_MS, 'Following orders at SNB', () => (busy = busy.then(follow)));
      void pollLoop();
      return done;
    },
    stop,
    // For tests and the status line.
    handle,
    handleCancel,
    follow,
    recover,
    heartbeat,
    positions,
    state: () => ({ lastOk, halted, mode, deadMan: deadManTripped(), clockOffset }),
    idle: () => busy,
  };
}
