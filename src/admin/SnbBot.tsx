import type { TradingSummary } from '../../shared/trading';

const when = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';

/**
 * StockSmart's SNB desktop bot, next to the device bot so both bots are reviewed in one place. Its key is made and
 * revoked in StockSmart itself (where going live is decided), so this card shows the state and links there.
 */
export function SnbBot({ s }: { s: TradingSummary }) {
  const b = s.bot;
  const live = s.mode === 'live';
  const state = !b.connected ? 'Not connected' : b.stale ? 'Not heard from' : b.brokerSession ? 'Running, logged in at SNB' : 'Running, logged out at SNB';
  const bad = (b.connected && (b.stale || !b.brokerSession)) || (live && !b.connected);
  return (
    <section aria-label="SNB bot" className="admin-card">
      <div className="between wrap">
        <h2 className="h2" style={{ fontSize: 18 }}>SNB bot (StockSmart)</h2>
        <a href="#/stocks" className="admin-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>{b.connected ? 'Manage in StockSmart' : 'Connect in StockSmart'}</a>
      </div>
      <span className="sub">
        Places real orders at SNB Capital from your computer. Needed only for real money; paper trading runs without it. It signs in with its own
        key and checks each order&apos;s signature. Your SNB password and OTP never leave your computer.
      </span>
      <div className="row wrap" style={{ gap: 20 }}>
        <span className="sub">Status <strong style={{ color: bad ? 'var(--danger)' : b.connected ? 'var(--success)' : 'var(--text2)' }}>{state}</strong></span>
        <span className="sub">Last seen <strong>{when(b.lastSeen)}</strong></span>
        <span className="sub">Desk <strong>{live ? 'LIVE' : 'Paper'}{s.halted ? ' · stopped' : ''}</strong></span>
      </div>
      {!b.connected && <div style={{ fontSize: 13 }}>→ StockSmart → Limits and settings → Connect the SNB bot: a key and a signing secret, shown once, go into the bot as STOCKSMART_KEY and STOCKSMART_SECRET.</div>}
    </section>
  );
}
