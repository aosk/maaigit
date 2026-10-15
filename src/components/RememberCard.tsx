import { useState } from 'react';
import type { ProfileCategory, Proposal } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { Plus } from './Icons';

type Remember = Extract<Proposal, { kind: 'remember' }>;
const CATEGORIES: ProfileCategory[] = ['preference', 'person', 'routine', 'work', 'other'];

/** A fact MAAI wants to keep about the user. Editable; nothing is kept until the user taps Keep it. */
export function RememberCard({ proposal, onChange }: { proposal: Remember; onChange: (p: Proposal) => void }) {
  const { t } = useSettings();
  const [text, setText] = useState(proposal.title);
  const [category, setCategory] = useState<ProfileCategory>(proposal.category);
  const { busy, error, run } = useAction();
  const done = proposal.status !== 'pending';

  return (
    <section className={`card approval${done ? ' done' : ''}`} aria-label={t.rememberTitle}>
      <div className="card-label"><Plus size={18} />{t.rememberTitle}</div>
      <div className="field">
        <label htmlFor={`rem-${proposal.id}`}>{t.profileAddLabel}</label>
        <textarea id={`rem-${proposal.id}`} rows={2} maxLength={200} value={text} disabled={done} onChange={(e) => setText(e.target.value)} style={{ minHeight: 64 }} />
      </div>
      <div className="field">
        <label htmlFor={`cat-${proposal.id}`}>{t.profileCategoryLabel}</label>
        <select id={`cat-${proposal.id}`} value={category} disabled={done} onChange={(e) => setCategory(e.target.value as ProfileCategory)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{t.profileCategory[c]}</option>)}
        </select>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {done ? (
        <div className={`status-tag ${proposal.status}`} role="status">{proposal.status === 'approved' ? `✓ ${t.rememberKept}` : t.cancelled}</div>
      ) : (
        <div className="row">
          <button className="btn primary big" style={{ flex: 2 }} disabled={busy || !text.trim()} onClick={() => run(async () => onChange(await api.approveRemember(proposal.id, { text, category })))}>{t.rememberKeep}</button>
          <button className="btn danger big grow" disabled={busy} onClick={() => run(async () => onChange(await api.cancel(proposal.id)))}>{t.cancel}</button>
        </div>
      )}
    </section>
  );
}
