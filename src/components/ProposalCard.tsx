import { useState } from 'react';
import type { Proposal } from '../../shared/types';
import { api } from '../api';
import { dayTime } from '../format';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { Bell, Calendar } from './Icons';
import { EmailCard } from './EmailCard';

/** An approval card from the assistant: nothing happens until the user approves it. */
export function ProposalCard({ proposal, gmail, onChange }: { proposal: Proposal; gmail: boolean; onChange: (p: Proposal) => void }) {
  if (proposal.kind === 'email') return <EmailCard proposal={proposal} gmail={gmail} onChange={onChange} />;
  return <PlanCard proposal={proposal} onChange={onChange} />;
}

function PlanCard({ proposal, onChange }: { proposal: Exclude<Proposal, { kind: 'email' }>; onChange: (p: Proposal) => void }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [picked, setPicked] = useState(proposal.kind === 'meeting' ? proposal.chosen ?? proposal.options[0]?.start : undefined);
  const { busy, error, run } = useAction();
  const done = proposal.status !== 'pending';

  const act = (kind: 'approve' | 'cancel') =>
    run(async () => onChange(kind === 'approve' ? await api.approve(proposal.id, picked) : await api.cancel(proposal.id)));

  const repeatLabel = { once: t.repeatOnce, daily: t.repeatDaily, weekly: t.repeatWeekly };

  return (
    <section className={`card approval${done ? ' done' : ''}`} aria-label={proposal.title}>
      <div className="card-label">
        {proposal.kind === 'meeting' ? <Calendar size={18} /> : <Bell size={18} />}
        {proposal.kind === 'meeting' ? t.needsApproval : t.newReminder}
      </div>
      <div style={{ fontWeight: 600 }}>
        {proposal.title}
        {proposal.kind === 'meeting' && ` · ${t.minutesShort(proposal.minutes)}`}
      </div>

      {proposal.kind === 'meeting' ? (
        <>
          <div role="radiogroup" aria-label={t.timeOptions} className="chips">
            {proposal.options.map((o) => (
              <button
                key={o.start}
                role="radio"
                aria-checked={picked === o.start}
                className="option"
                disabled={done}
                onClick={() => setPicked(o.start)}
              >
                <span>{dayTime(o.start, lang)}</span>
                <span className="sub">{o.note}</span>
              </button>
            ))}
          </div>
          <div className="sub">{t.inviteNote(proposal.attendeeEmail)}</div>
        </>
      ) : (
        <div>
          <div className="kv"><span>{t.time}</span><span>{proposal.at ? dayTime(proposal.at, lang) : proposal.when}</span></div>
          <div className="kv"><span>{t.repeat}</span><span>{repeatLabel[proposal.repeat]}</span></div>
        </div>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      {done ? (
        <div className={`status-tag ${proposal.status}`} role="status">
          {proposal.status === 'approved' ? `✓ ${t.approved}` : t.cancelled}
          {proposal.kind === 'meeting' && proposal.chosen ? ` · ${dayTime(proposal.chosen, lang)}` : ''}
        </div>
      ) : (
        <div className="row">
          <button className="btn primary big" style={{ flex: 2 }} disabled={busy} onClick={() => act('approve')}>
            {proposal.kind === 'meeting' ? t.approveSend : t.approve}
          </button>
          <button className="btn danger big grow" disabled={busy} onClick={() => act('cancel')}>{t.cancel}</button>
        </div>
      )}
    </section>
  );
}
