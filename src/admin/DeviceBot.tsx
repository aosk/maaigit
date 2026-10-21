import { useCallback, useEffect, useState } from 'react';
import type { BotOverview } from '../../shared/types';
import { api } from '../api';

const when = (iso?: string) =>
  iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';

/** The user's device bot: its key (shown once when made), whether it is checking in, and what MAAI asked it to do. */
export function DeviceBot() {
  const [data, setData] = useState<BotOverview | null>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback((background = false) => {
    api.bot(background).then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(() => document.hidden || load(true), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(what: 'key' | 'off') {
    const sure = what === 'key'
      ? window.confirm(data?.status.connected ? 'Make a new key? The bot stops working until you give it the new one.' : 'Make a device key for your bot?')
      : window.confirm('Disconnect the device bot? Its key stops working and nothing waiting is sent.');
    if (!sure) return;
    setBusy(true);
    setError('');
    try {
      if (what === 'key') {
        const made = await api.botKey();
        setKey(made.key);
        setData(made);
      } else {
        setKey('');
        setData(await api.botDisconnect());
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const s = data?.status;
  const address = `${window.location.origin}/bot/v1`;
  return (
    <section id="device" aria-label="Device bot" className="admin-card">
      <div className="between wrap">
        <h2 className="h2" style={{ fontSize: 18 }}>Device bot</h2>
        <div className="row wrap">
          <button className="admin-btn" onClick={() => act('key')} disabled={busy}>{s?.connected ? 'New key' : 'Make a device key'}</button>
          {s?.connected && <button className="admin-btn" onClick={() => act('off')} disabled={busy}>Disconnect</button>}
        </div>
      </div>
      <p className="sub">
        Your own bot (for example Grok on your computer or phone) connects to MAAI at <code>{address}</code> with this key: it delivers your WhatsApp and email every hour and picks up commands every minute. MAAI only ever sends it the fixed WhatsApp note and what you approved. See docs/device-bot.md.
      </p>
      {key && (
        <div className="banner" role="status" style={{ wordBreak: 'break-all' }}>
          <strong>Copy this key into your bot now. It is shown only once:</strong>
          <div style={{ fontFamily: 'ui-monospace, monospace', marginTop: 6, userSelect: 'all' }}>{key}</div>
          <button className="admin-btn" style={{ marginTop: 8 }} onClick={() => void navigator.clipboard?.writeText(key).catch(() => {})}>Copy</button>
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
      {s && (
        <div className="row wrap" style={{ gap: 24 }}>
          <span><span className="sub">Status </span><strong style={{ color: !s.connected ? 'var(--text2)' : s.stale ? 'var(--danger)' : 'var(--success)' }}>{!s.connected ? 'Not connected' : s.stale ? 'Silent over 2 hours' : 'Working'}</strong></span>
          {s.connected && <span><span className="sub">Key </span>{s.keyHint}…</span>}
          {s.device && <span><span className="sub">Device </span>{s.device}</span>}
          <span><span className="sub">Last seen </span>{when(s.lastSeen)}</span>
          <span><span className="sub">Last messages </span>{when(s.lastSync)}</span>
          <span><span className="sub">Kept </span>{s.messages}</span>
          <span><span className="sub">Waiting </span>{s.waiting}</span>
        </div>
      )}
      {data && data.commands.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table">
            <thead><tr><th>When</th><th>What</th><th>Status</th><th>Result</th></tr></thead>
            <tbody>
              {data.commands.map((c) => (
                <tr key={c.id}>
                  <td className="sub" style={{ whiteSpace: 'nowrap' }}>{when(c.createdAt)}</td>
                  <td dir="auto">{c.kind === 'reply' ? `${c.automatic ? 'Fixed note' : 'WhatsApp reply'} to ${c.toName ?? `+${c.phone}`}` : c.text}</td>
                  <td>{c.status}</td>
                  <td className="sub" dir="auto" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.result ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
