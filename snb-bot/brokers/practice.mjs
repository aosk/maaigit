// Practice: goes through every step of an order exactly as the real broker part will (StockSmart's checks, the
// confirmation compared with the command, the last "still go?") and stops short of SNB. Nothing is placed, ever.
// Each order is reported "failed: practice", so StockSmart shows what would have happened and books nothing.
export function practiceBroker({ log = console.log } = {}) {
  return {
    practice: true,
    name: 'practice (places nothing)',
    async session() {
      return { loggedIn: true };
    },
    async quotes() {
      return [];
    },
    /** Not read in practice: StockSmart's live book is left as it is. */
    async account() {
      return null;
    },
    /** Nothing is ever at SNB in practice, so a cancel always succeeds. */
    async cancel() {
      return { status: 'cancelled' };
    },
    async place(cmd, { beforeSubmit, sameOrder, progress }) {
      await progress('practice: order form filled');
      // What the confirmation screen would show; the real broker reads it from SNB.
      const shown = { symbol: cmd.symbol, side: cmd.side, qty: cmd.qty, limitPrice: cmd.limitPrice };
      if (!sameOrder(shown)) return { status: 'failed', error: 'The confirmation did not match the order.' };
      await progress('practice: confirmation checked');
      if (!(await beforeSubmit())) return { status: 'failed', error: 'Practice: StockSmart said not to go at the last check.' };
      // Practice stops short of Submit, so even after "go" nothing reached SNB: "failed" (not "unknown") is the truth.
      log(`  (practice) would press Submit now: ${cmd.side} ${cmd.qty} × ${cmd.symbol} at ${Number(cmd.limitPrice).toFixed(2)}`);
      return { status: 'failed', beforeSubmit: true, error: `Practice mode: not placed (would have ${cmd.side === 'buy' ? 'bought' : 'sold'} ${cmd.qty} × ${cmd.symbol} at ${Number(cmd.limitPrice).toFixed(2)}).` };
    },
  };
}
