import type { AsanaProject } from '../../shared/types';
import type { NewAsanaTask } from '../api';
import { useSettings } from '../settings';

/** The fields of a new Asana task, shared by the approval card and the New task form on Today. */
export function AsanaNewFields({ idPrefix, value, projects, disabled, onChange }: { idPrefix: string; value: NewAsanaTask; projects: AsanaProject[]; disabled?: boolean; onChange: (task: NewAsanaTask) => void }) {
  const { t } = useSettings();
  const set = (patch: Partial<NewAsanaTask>) => onChange({ ...value, ...patch });
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-name`}>{t.asanaName}</label>
        <input id={`${idPrefix}-name`} dir="auto" value={value.name} onChange={(e) => set({ name: e.target.value })} disabled={disabled} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-notes`}>{t.asanaNotes}</label>
        <textarea id={`${idPrefix}-notes`} dir="auto" value={value.notes} onChange={(e) => set({ notes: e.target.value })} disabled={disabled} style={{ minHeight: 72 }} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-project`}>{t.asanaProject}</label>
        <select id={`${idPrefix}-project`} value={value.projectGid} onChange={(e) => set({ projectGid: e.target.value })} disabled={disabled}>
          <option value="">{t.asanaNoProject}</option>
          {projects.map((p) => (
            <option key={p.gid} value={p.gid}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-due`}>{t.asanaDueDate}</label>
        <input id={`${idPrefix}-due`} type="date" dir="ltr" value={value.dueOn} onChange={(e) => set({ dueOn: e.target.value })} disabled={disabled} />
      </div>
    </>
  );
}
