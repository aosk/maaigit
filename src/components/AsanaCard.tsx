import { useState } from 'react';
import type { Proposal } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { Check } from './Icons';

type AsanaProposal = Extract<Proposal, { kind: 'asana' }>;

/** A change MAAI wants to make to an Asana task. Everything is editable; nothing changes until the user approves. */
export function AsanaCard({ proposal, onChange }: { proposal: AsanaProposal; onChange: (p: Proposal) => void }) {
  const { t } = useSettings();
  const [comment, setComment] = useState(proposal.comment);
  const [complete, setComplete] = useState(proposal.complete);
  const [dueOn, setDueOn] = useState(proposal.dueOn);
  const { busy, error, run } = useAction();
  const done = proposal.status !== 'pending';
  const fid = (name: string) => `${name}-${proposal.id}`;
  const empty = !comment.trim() && !complete && !dueOn;

  const approve = () => run(async () => onChange(await api.approveAsana(proposal.id, { comment, complete, dueOn })));
  const cancel = () => run(async () => onChange(await api.cancel(proposal.id)));

  return (
    <section className={`card approval${done ? ' done' : ''}`} aria-label={t.asanaUpdate}>
      <div className="card-label"><Check size={18} />{t.asanaUpdate}</div>
      <div style={{ fontWeight: 600 }}>
        {proposal.taskUrl ? <a href={proposal.taskUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{proposal.taskName}</a> : proposal.taskName}
      </div>

      <div className="field">
        <label htmlFor={fid('comment')}>{t.asanaComment}</label>
        <textarea id={fid('comment')} dir="auto" value={comment} onChange={(e) => setComment(e.target.value)} disabled={done} style={{ minHeight: 96 }} />
      </div>
      <div className="toggle-row" style={{ padding: 0 }}>
        <span id={fid('done-label')}>{t.asanaMarkDone}</span>
        <button role="switch" className="switch" aria-checked={complete} aria-labelledby={fid('done-label')} disabled={done} onClick={() => setComplete((v) => !v)}>
          <span />
        </button>
      </div>
      <div className="field">
        <label htmlFor={fid('due')}>{t.asanaDue}</label>
        <input id={fid('due')} type="date" dir="ltr" value={dueOn} onChange={(e) => setDueOn(e.target.value)} disabled={done} />
      </div>

      {error && <div className="error" role="alert">{error}</div>}

      {done ? (
        <div className={`status-tag ${proposal.status}`} role="status">{proposal.status === 'approved' ? `✓ ${t.asanaDone}` : t.cancelled}</div>
      ) : (
        <div className="row">
          <button className="btn primary big" style={{ flex: 2 }} disabled={busy || empty} onClick={approve}>{busy ? t.sending : t.asanaApply}</button>
          <button className="btn danger big grow" disabled={busy} onClick={cancel}>{t.cancel}</button>
        </div>
      )}
    </section>
  );
}
