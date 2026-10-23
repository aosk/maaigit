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
  const [orderPhone, setOrderPhone] = useState<string | null>(null);
  const [pin, setPin] = useState('');

  const load = useCallback((background = false) => {
    api.bot(background).then((d) => { setData(d); setError(''); }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    // Faster while a linking code is shown, so a new one appears soon after WhatsApp makes it.
    const timer = setInterval(() => document.hidden || load(true), 10_000);
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

  async function restart() {
    if (!window.confirm('Restart the bot on your computer? It reconnects to WhatsApp by itself (no new link) and takes the newest version.')) return;
    setBusy(true);
    setError('');
    try {
      setData(await api.restartBot());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveOrderPhone(phone: string) {
    if (phone && !window.confirm(`Take orders from +${phone.replace(/\D/g, '')}? Whoever has that phone can ask MAAI about your email, calendar and messages (anything that sends or changes something still needs your approval in MAAI).`)) return;
    setBusy(true);
    setError('');
    try {
      setData(await api.setOrderPhone(phone));
      setOrderPhone(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePin(value: string) {
    if (!value && !window.confirm('Remove the PIN? Cards can then be approved only in the app.')) return;
    setBusy(true);
    setError('');
    try {
      setData(await api.setOrderPin(value));
      setPin('');
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
          {s?.connected && <button className="admin-btn" onClick={() => void restart()} disabled={busy}>Restart bot</button>}
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
      {s?.link && (
        <div className="banner" role="status" dir="rtl" lang="ar">
          <strong>واتساب على جهازك يحتاج ربط</strong>
          {s.link.code ? (
            <>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 32, letterSpacing: 4, margin: '8px 0', userSelect: 'all' }} dir="ltr">{s.link.code.slice(0, 4)}-{s.link.code.slice(4)}</div>
              <div className="sub">في جوالك: واتساب ← الأجهزة المرتبطة ← ربط جهاز ← <strong>الربط برقم الهاتف بدلاً من ذلك</strong>، واكتب الرمز. (أو اضغط تنبيه واتساب اللي وصلك.) يتجدد كل 3 دقائق، وهذه الصفحة تعرض الجديد تلقائياً.</div>
            </>
          ) : (
            <div className="sub">امسح رمز QR الظاهر على شاشة الكمبيوتر: واتساب ← الأجهزة المرتبطة ← ربط جهاز. وللربط برمز بدل المسح: أضف <code dir="ltr">MY_PHONE=9665XXXXXXXX</code> في ملف <code>.env</code> للبوت.</div>
          )}
        </div>
      )}
      {s?.connected && (
        <div className="field">
          <label htmlFor="order-phone"><strong>Order number</strong> (your own second WhatsApp)</label>
          <p className="sub" style={{ margin: '4px 0' }}>
            Private messages from this one number to your main WhatsApp go to the assistant as orders, and the answer comes back to it. Messages from anyone else, groups and forwards are never orders. Anything that sends, books or changes something waits for your approval in MAAI.
          </p>
          <div className="row wrap">
            <input id="order-phone" dir="ltr" inputMode="tel" placeholder="9665XXXXXXXX" value={orderPhone ?? s.orderPhone ?? ''} onChange={(e) => setOrderPhone(e.target.value)} disabled={busy} />
            <button className="admin-btn" disabled={busy || orderPhone === null || !orderPhone.trim()} onClick={() => void saveOrderPhone(orderPhone ?? '')}>Save</button>
            {s.orderPhone && <button className="admin-btn" disabled={busy} onClick={() => void saveOrderPhone('')}>Stop taking orders</button>}
          </div>
          {s.orderPhone && <div className="sub">Taking orders from +{s.orderPhone}</div>}
          {s.orderPhone && (
            <>
              <label htmlFor="order-pin" style={{ marginTop: 12, display: 'block' }}><strong>Approval PIN</strong> (approve cards from that number)</label>
              <p className="sub" style={{ margin: '4px 0' }}>
                With a PIN, reply <code dir="ltr">approve 3 PIN</code> (or <code>موافق 3 PIN</code>) to carry out card #3, and <code>cancel 3</code> to drop it. 3 wrong PINs lock it for an hour. Every approval is logged and your phones are told. Tasks on your computer are approved in the app only. Use a PIN that is not your phone's passcode, and turn on disappearing messages in that chat so the PIN does not stay there.
              </p>
              <div className="row wrap">
                <input id="order-pin" type="password" inputMode="numeric" autoComplete="new-password" placeholder={s.orderPin ? 'New PIN (6–8 digits)' : '6–8 digits'} value={pin} maxLength={8} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} disabled={busy} />
                <button className="admin-btn" disabled={busy || pin.length < 6} onClick={() => void savePin(pin)}>{s.orderPin ? 'Change PIN' : 'Set PIN'}</button>
                {s.orderPin && <button className="admin-btn" disabled={busy} onClick={() => void savePin('')}>Remove PIN</button>}
              </div>
              <div className="sub">{s.orderPin ? 'PIN set: cards can be approved from WhatsApp.' : 'No PIN: cards are approved in the app only.'}</div>
            </>
          )}
        </div>
      )}
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
                  <td dir="auto">{c.kind === 'reply' ? `${c.automatic ? 'Automatic reply' : 'WhatsApp reply'} to ${c.toName ?? `+${c.phone}`}` : c.text}</td>
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
