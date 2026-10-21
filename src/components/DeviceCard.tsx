import { useState } from 'react';
import type { Proposal } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { Send } from './Icons';

type DeviceTask = Extract<Proposal, { kind: 'device' }>;

/** A task MAAI wants to send to the user's device bot. Editable; nothing is sent until the user taps Send. */
export function DeviceCard({ proposal, onChange }: { proposal: DeviceTask; onChange: (p: Proposal) => void }) {
  const { t } = useSettings();
  const [task, setTask] = useState(proposal.task);
  const { busy, error, run } = useAction();
  const done = proposal.status !== 'pending';

  return (
    <section className={`card approval${done ? ' done' : ''}`} aria-label={t.deviceTitle}>
      <div className="card-label"><Send size={18} />{t.deviceTitle}</div>
      <div style={{ fontWeight: 600 }} dir="auto">{proposal.title}</div>
      <div className="field">
        <label htmlFor={`dev-${proposal.id}`}>{t.deviceTask}</label>
        <textarea id={`dev-${proposal.id}`} rows={3} maxLength={1000} value={task} disabled={done} onChange={(e) => setTask(e.target.value)} dir="auto" />
      </div>
      <div className="sub">{t.deviceNote}</div>
      {error && <div className="error" role="alert">{error}</div>}
      {done ? (
        <div className={`status-tag ${proposal.status}`} role="status">{proposal.status === 'approved' ? `✓ ${t.deviceSent}` : t.cancelled}</div>
      ) : (
        <div className="row">
          <button className="btn primary big" style={{ flex: 2 }} disabled={busy || !task.trim()} onClick={() => run(async () => onChange(await api.approveDevice(proposal.id, task)))}>{t.deviceSend}</button>
          <button className="btn danger big grow" disabled={busy} onClick={() => run(async () => onChange(await api.cancel(proposal.id)))}>{t.cancel}</button>
        </div>
      )}
    </section>
  );
}
