import { useState, type FormEvent } from 'react';
import type { ApiKeyView, KeyService } from '../../shared/types';
import { api } from '../api';
import { LevelPill } from './levels';

const SERVICE_NAMES: Record<KeyService, string> = {
  anthropic: 'Anthropic (Claude)',
  xai: 'xAI (Grok)',
  render: 'Render',
  openai: 'OpenAI',
  groq: 'Groq',
  google: 'Google',
  asana: 'Asana',
  twilio: 'Twilio',
  github: 'GitHub',
  other: 'Other',
};

const when = (k: ApiKeyView) =>
  k.daysLeft === undefined ? 'No expiry date' : k.daysLeft < 0 ? `Expired ${-k.daysLeft} day${k.daysLeft === -1 ? '' : 's'} ago` : k.daysLeft === 0 ? 'Expires today' : `${k.daysLeft} day${k.daysLeft === 1 ? '' : 's'} left`;

/** How many keys need the user (expiring within 14 days, or expired): for the menu badge. */
export const keysDue = (list: ApiKeyView[] | null) => (list ?? []).filter((k) => k.level === 'medium' || k.level === 'high').length;

/** One key: its name, service, where it is used, how long it has, and the actions. */
function KeyRow({ k, onChange }: { k: ApiKeyView; onChange: (list: ApiKeyView[]) => void }) {
  const [editing, setEditing] = useState<'date' | 'renew' | null>(null);
  const [date, setDate] = useState(k.expiresOn ?? '');
  const [error, setError] = useState('');

  async function run(p: Promise<ApiKeyView[]>) {
    try {
      onChange(await p);
      setEditing(null);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <li className={`ky-row ky-${k.level}`}>
      <div className="between wrap" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <strong style={{ overflowWrap: 'anywhere' }}>{k.name}</strong>
            {k.source === 'email' && <span className="tag-chip">from email</span>}
            {k.inUse && <span className="tag-chip">in use by MAAI</span>}
          </div>
          <div className="sub">
            {SERVICE_NAMES[k.service]}
            {k.envVar ? <> · <code>{k.envVar}</code></> : ''}
            {k.expiresOn ? ` · ${k.expiresOn}` : ''}
            {k.renewedAt ? ` · renewed ${k.renewedAt.slice(0, 10)}` : ''}
          </div>
          {k.note && <div className="sub" style={{ overflowWrap: 'anywhere' }}>{k.note}</div>}
        </div>
        {k.level === 'none' ? <span className="sub" style={{ fontWeight: 600 }}>{when(k)}</span> : <LevelPill level={k.level} label={when(k)} />}
      </div>

      {editing ? (
        <form
          className="row wrap"
          style={{ gap: 8 }}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(api.adminUpdateKey(k.id, { expiresOn: date, renewed: editing === 'renew' }));
          }}
        >
          <label className="sub" htmlFor={`d-${k.id}`}>{editing === 'renew' ? 'The new key expires on' : 'Expires on'}</label>
          <input id={`d-${k.id}`} type="date" className="admin-input" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="admin-btn ky-primary" type="submit">{editing === 'renew' ? 'Mark renewed' : 'Save'}</button>
          <button className="admin-btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
          {editing === 'renew' && <span className="sub" style={{ flexBasis: '100%' }}>Leave the date empty if the new key does not expire.</span>}
        </form>
      ) : (
        <div className="row wrap" style={{ gap: 8 }}>
          {k.renewUrl && <a className="admin-btn ky-link" href={k.renewUrl} target="_blank" rel="noreferrer">Make a new key ↗</a>}
          <button className="admin-btn" onClick={() => { setDate(''); setEditing('renew'); }}>I renewed it</button>
          <button className="admin-btn" onClick={() => { setDate(k.expiresOn ?? ''); setEditing('date'); }}>{k.expiresOn ? 'Change date' : 'Add expiry date'}</button>
          {!k.id.startsWith('env:') && (
            <button className="admin-btn" onClick={() => window.confirm(`Stop reminding about “${k.name}”?`) && void run(api.adminRemoveKey(k.id))}>Remove</button>
          )}
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </li>
  );
}

/** Reminders to renew API keys before they expire. */
export function Keys({ list, onChange }: { list: ApiKeyView[] | null; onChange: (list: ApiKeyView[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', service: 'anthropic' as KeyService, expiresOn: '', envVar: '' });
  const [error, setError] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      onChange(await api.adminAddKey(form));
      setForm({ name: '', service: 'anthropic', expiresOn: '', envVar: '' });
      setAdding(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const due = keysDue(list);
  return (
    <section id="keys" aria-label="API keys" className="admin-card" style={{ gap: 14 }}>
      <div className="between wrap" style={{ gap: 8 }}>
        <div>
          <h2 className="h2" style={{ fontSize: 18 }}>API keys</h2>
          <span className="sub">Reminders before they expire · only names and dates are kept here, never a key</span>
        </div>
        <button className="admin-btn ky-primary" onClick={() => { setError(''); setAdding(!adding); }}>{adding ? 'Close' : 'Add a key'}</button>
      </div>

      {due > 0 && <div className="banner" role="status"><strong>{due} key{due === 1 ? '' : 's'} to renew soon.</strong> Your phone is told 14, 7, 3 and 1 days before, and on the day.</div>}

      {adding && (
        <form className="ky-form" onSubmit={add}>
          <label>
            <span className="sub">Name (as the service shows it, e.g. najizsupport)</span>
            <input className="admin-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} autoComplete="off" />
          </label>
          <label>
            <span className="sub">Service</span>
            <select className="admin-input" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value as KeyService })}>
              {(Object.keys(SERVICE_NAMES) as KeyService[]).map((s) => <option key={s} value={s}>{SERVICE_NAMES[s]}</option>)}
            </select>
          </label>
          <label>
            <span className="sub">Expires on</span>
            <input type="date" className="admin-input" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} />
          </label>
          <label>
            <span className="sub">Used in (optional, e.g. ANTHROPIC_API_KEY)</span>
            <input className="admin-input" value={form.envVar} onChange={(e) => setForm({ ...form, envVar: e.target.value.toUpperCase() })} maxLength={60} autoComplete="off" />
          </label>
          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
            <button className="admin-btn ky-primary" type="submit">Add reminder</button>
            <span className="sub">Never paste the key itself: it is refused.</span>
          </div>
          {error && <div className="error" role="alert">{error}</div>}
        </form>
      )}

      {list === null ? (
        <div className="skeleton"><span /><span /></div>
      ) : list.length === 0 ? (
        <p className="sub">No keys yet. Add one, or MAAI adds it by itself when an “API key expiring” email reaches your Gmail.</p>
      ) : (
        <ul className="ky-list">{list.map((k) => <KeyRow key={k.id} k={k} onChange={onChange} />)}</ul>
      )}
      <p className="sub" style={{ margin: 0 }}>
        Expiry emails from Anthropic, Render, xAI, OpenAI, Google, GitHub and the others listed are picked up from your Gmail inbox by themselves. Keys MAAI runs on are listed from its settings: add their dates.
      </p>
    </section>
  );
}
