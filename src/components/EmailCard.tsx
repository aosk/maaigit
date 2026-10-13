import { useState } from 'react';
import type { Proposal } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { Send } from './Icons';

type EmailProposal = Extract<Proposal, { kind: 'email' }>;

export const mailtoLink = (to: string, subject: string, body: string) =>
  `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** An email MAAI drafted. Everything is editable; nothing is sent until the user taps Send. */
export function EmailCard({ proposal, gmail, onChange }: { proposal: EmailProposal; gmail: boolean; onChange: (p: Proposal) => void }) {
  const { t } = useSettings();
  const [to, setTo] = useState(proposal.to);
  const [subject, setSubject] = useState(proposal.subject);
  const [body, setBody] = useState(proposal.body);
  const { busy, error, run } = useAction();
  const done = proposal.status !== 'pending';
  const fid = (name: string) => `${name}-${proposal.id}`;

  const send = () => run(async () => onChange(await api.approveEmail(proposal.id, { to, subject, body })));
  const cancel = () => run(async () => onChange(await api.cancel(proposal.id)));

  return (
    <section className={`card approval${done ? ' done' : ''}`} aria-label={t.emailDraft}>
      <div className="card-label"><Send size={18} />{t.emailDraft}</div>
      <div className="field">
        <label htmlFor={fid('to')}>{t.emailTo}</label>
        <input id={fid('to')} type="email" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} disabled={done} />
      </div>
      <div className="field">
        <label htmlFor={fid('subject')}>{t.emailSubject}</label>
        <input id={fid('subject')} dir="auto" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={done} />
      </div>
      <div className="field">
        <label htmlFor={fid('body')}>{t.message}</label>
        <textarea id={fid('body')} dir="auto" value={body} onChange={(e) => setBody(e.target.value)} disabled={done} style={{ minHeight: 160 }} />
      </div>

      {error && <div className="error" role="alert">{error}</div>}

      {done ? (
        <div className={`status-tag ${proposal.status}`} role="status">
          {proposal.status === 'approved' ? `✓ ${t.emailSent(proposal.to)}` : t.cancelled}
        </div>
      ) : (
        <>
          <div className="row">
            {gmail ? (
              <button className="btn primary big" style={{ flex: 2 }} disabled={busy || !to.trim()} onClick={send}>
                <Send size={18} />{busy ? t.sending : t.sendEmail}
              </button>
            ) : (
              <a className="btn primary big" style={{ flex: 2, textDecoration: 'none' }} href={mailtoLink(to, subject, body)}>
                {t.openMailApp}
              </a>
            )}
            <button className="btn danger big grow" disabled={busy} onClick={cancel}>{t.cancel}</button>
          </div>
          <div className="sub">{gmail ? t.emailFromGmail : t.gmailNotConnected}</div>
        </>
      )}
    </section>
  );
}
