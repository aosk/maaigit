import { useEffect, useState } from 'react';
import type { AsanaProject, Proposal } from '../../shared/types';
import { api, type NewAsanaTask } from '../api';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { Plus } from './Icons';
import { AsanaNewFields } from './AsanaNewFields';

type NewTaskProposal = Extract<Proposal, { kind: 'asana_new' }>;

/** A task MAAI wants to create in Asana. Everything is editable; nothing is created until the user taps Create. */
export function AsanaNewCard({ proposal, onChange }: { proposal: NewTaskProposal; onChange: (p: Proposal) => void }) {
  const { t } = useSettings();
  const [task, setTask] = useState<NewAsanaTask>({ name: proposal.title, notes: proposal.notes, dueOn: proposal.dueOn, projectGid: proposal.projectGid });
  const [projects, setProjects] = useState<AsanaProject[]>([]);
  const { busy, error, run } = useAction();
  const done = proposal.status !== 'pending';

  useEffect(() => {
    api.asanaProjects().then(setProjects).catch(() => {});
  }, []);

  const create = () => run(async () => onChange(await api.approveAsanaNew(proposal.id, task)));
  const cancel = () => run(async () => onChange(await api.cancel(proposal.id)));

  return (
    <section className={`card approval${done ? ' done' : ''}`} aria-label={t.asanaNewTitle}>
      <div className="card-label"><Plus size={18} />{t.asanaNewTitle}</div>
      <AsanaNewFields idPrefix={`new-${proposal.id}`} value={task} projects={projects} disabled={done} onChange={setTask} />
      {error && <div className="error" role="alert">{error}</div>}
      {done ? (
        <div className={`status-tag ${proposal.status}`} role="status">
          {proposal.status === 'approved' ? <>✓ {t.asanaCreated}{proposal.taskUrl && <> · <a href={proposal.taskUrl} target="_blank" rel="noreferrer">{t.asanaOpen}</a></>}</> : t.cancelled}
        </div>
      ) : (
        <div className="row">
          <button className="btn primary big" style={{ flex: 2 }} disabled={busy || !task.name.trim()} onClick={create}>{busy ? t.sending : t.asanaCreate}</button>
          <button className="btn danger big grow" disabled={busy} onClick={cancel}>{t.cancel}</button>
        </div>
      )}
    </section>
  );
}
