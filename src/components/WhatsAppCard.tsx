import { useState } from 'react';
import type { Proposal } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { Send } from './Icons';

type WhatsAppProposal = Extract<Proposal, { kind: 'whatsapp' }>;

/** A WhatsApp reply MAAI drafted. Editable; nothing is sent until the user taps Send. */
export function WhatsAppCard({ proposal, onChange }: { proposal: WhatsAppProposal; onChange: (p: Proposal) => void }) {
  const { t } = useSettings();
  const [body, setBody] = useState(proposal.body);
  const { busy, error, run } = useAction();
  const done = proposal.status !== 'pending';
  const fid = `wa-body-${proposal.id}`;

  const send = () => run(async () => onChange(await api.approveWhatsApp(proposal.id, body)));
  const cancel = () => run(async () => onChange(await api.cancel(proposal.id)));
  const openWhatsApp = `https://wa.me/${proposal.phone}?text=${encodeURIComponent(body)}`;

  return (
    <section className={`card approval${done ? ' done' : ''}`} aria-label={t.whatsappDraft}>
      <div className="card-label"><Send size={18} />{t.whatsappDraft} · {proposal.toName}</div>
      <div className="field">
        <label htmlFor={fid}>{t.message}</label>
        <textarea id={fid} dir="auto" value={body} onChange={(e) => setBody(e.target.value)} disabled={done} style={{ minHeight: 120 }} />
      </div>

      {error && <div className="error" role="alert">{error}</div>}

      {done ? (
        <div className={`status-tag ${proposal.status}`} role="status">
          {proposal.status === 'approved' ? `✓ ${t.whatsappSentTo(proposal.toName)}` : t.cancelled}
        </div>
      ) : (
        <>
          <div className="row">
            {proposal.canSend ? (
              <button className="btn primary big" style={{ flex: 2 }} disabled={busy || !body.trim()} onClick={send}>
                <Send size={18} />{busy ? t.sending : t.sendOnWhatsApp}
              </button>
            ) : (
              <a className="btn primary big" style={{ flex: 2, textDecoration: 'none' }} href={openWhatsApp} target="_blank" rel="noreferrer">
                {t.openWhatsApp}
              </a>
            )}
            <button className="btn danger big grow" disabled={busy} onClick={cancel}>{t.cancel}</button>
          </div>
          {!proposal.canSend && <div className="sub" role="note">{t.whatsappWindowClosed}</div>}
        </>
      )}
    </section>
  );
}
