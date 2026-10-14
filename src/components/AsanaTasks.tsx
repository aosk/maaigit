import { useCallback, useEffect, useState } from 'react';
import type { AsanaControl, AsanaOverview, AsanaProject, AsanaTask } from '../../shared/types';
import { api, type NewAsanaTask } from '../api';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { useOnRefresh } from '../refresh';
import { Plus } from './Icons';
import { AsanaNewFields } from './AsanaNewFields';

const EMPTY: NewAsanaTask = { name: '', notes: '', dueOn: '', projectGid: '' };
const todayDate = () => new Date().toLocaleDateString('en-CA');

/** Your Asana tasks on Today: tick to finish, tap one to change its status or date, or add a new one. */
export function AsanaTasks() {
  const { t } = useSettings();
  const [data, setData] = useState<AsanaOverview | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewAsanaTask>(EMPTY);
  const [projects, setProjects] = useState<AsanaProject[]>([]);
  const [finished, setFinished] = useState<AsanaTask | null>(null);
  const [created, setCreated] = useState<AsanaTask | null>(null);
  const { busy, error, run } = useAction();

  const load = useCallback(() => api.asana().then(setData).catch(() => {}), []);
  useEffect(() => {
    void load();
  }, [load]);
  useOnRefresh(() => void load());

  // The "marked done" bar goes away by itself.
  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(() => setFinished(null), 10_000);
    return () => clearTimeout(timer);
  }, [finished]);

  if (!data) return null;

  function openForm() {
    setAdding(true);
    api.asanaProjects().then(setProjects).catch(() => {});
  }

  const complete = async (task: AsanaTask) => {
    setData((d) => d && { ...d, tasks: d.tasks.filter((x) => x.gid !== task.gid), open: d.open - 1 });
    const ok = await run(async () => {
      await api.asanaComplete(task.gid, true);
      return true;
    });
    if (ok) setFinished(task);
    await load();
  };

  const undo = (task: AsanaTask) =>
    run(async () => {
      await api.asanaComplete(task.gid, false);
      setFinished(null);
      await load();
    });

  const create = () =>
    run(async () => {
      const task = await api.asanaCreate(draft);
      setCreated(task);
      setDraft(EMPTY);
      setAdding(false);
      await load();
    });

  const note = !data.configured ? t.asanaOff : data.error ? t.asanaError(data.error) : data.tasks.length === 0 && !adding ? t.asanaNone : '';

  return (
    <>
      <div className="between extra">
        <h2 className="h2">{t.asanaTasks}</h2>
        <div className="row" style={{ gap: 8 }}>
          {data.overdue > 0 && <div className="pill warn">{t.asanaOverdue(data.overdue)}</div>}
          {data.configured && !data.error && (
            <button className="btn secondary round" onClick={() => (adding ? setAdding(false) : openForm())} aria-expanded={adding}>
              <Plus size={16} />{t.asanaNew}
            </button>
          )}
        </div>
      </div>

      {adding && (
        <section className="card extra" aria-label={t.asanaNewTitle}>
          <AsanaNewFields idPrefix="today-new" value={draft} projects={projects} disabled={busy} onChange={setDraft} />
          <div className="row">
            <button className="btn primary big" style={{ flex: 2 }} disabled={busy || !draft.name.trim()} onClick={create}>{busy ? t.sending : t.asanaCreate}</button>
            <button className="btn ghost big grow" onClick={() => setAdding(false)}>{t.cancel}</button>
          </div>
        </section>
      )}

      {error && <div className="error extra" role="alert">{error}</div>}
      {created && !adding && (
        <div className="undo-bar extra" role="status">
          <span>✓ {t.asanaCreated}: {created.name}</span>
          <a href={created.url} target="_blank" rel="noreferrer" className="link-btn">{t.asanaOpen}</a>
        </div>
      )}
      {finished && (
        <div className="undo-bar extra" role="status">
          <span>✓ {t.asanaMarkedDone(finished.name)}</span>
          <button className="link-btn" onClick={() => undo(finished)}>{t.undo}</button>
        </div>
      )}

      {note ? (
        <a className="card soft extra" href="#/settings" style={{ textDecoration: 'none', color: 'inherit' }}><span className="sub">{note}</span></a>
      ) : (
        data.tasks.length > 0 && (
          <section className="card flush extra" aria-label={t.asanaTasks}>
            {data.tasks.map((task) => (
              <TaskRow key={task.gid} task={task} disabled={busy} onComplete={() => complete(task)} onChanged={load} />
            ))}
          </section>
        )
      )}
    </>
  );
}

function TaskRow({ task, disabled, onComplete, onChanged }: { task: AsanaTask; disabled: boolean; onComplete: () => void; onChanged: () => void }) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const [controls, setControls] = useState<AsanaControl[] | null>(null);
  const { busy, error, run } = useAction();
  const today = todayDate();
  const overdue = task.dueOn && task.dueOn < today;

  function toggle() {
    setOpen((v) => !v);
    if (!controls) void run(async () => setControls(await api.asanaControls(task.gid)));
  }

  const setStatus = (index: number, optionGid: string) =>
    run(async () => {
      const control = controls![index];
      await api.asanaSetStatus(task.gid, { type: control.type, optionGid, fieldGid: control.fieldGid });
      setControls((list) => list && list.map((c, i) => (i === index ? { ...c, current: optionGid } : c)));
    });

  const setDue = (dueOn: string) =>
    run(async () => {
      await api.asanaSetDue(task.gid, dueOn);
      onChanged();
    });

  return (
    <div className="task">
      <div className="task-row">
        <button className="circle" aria-label={`${t.markDone}: ${task.name}`} disabled={disabled} onClick={onComplete} />
        <button className="task-open" aria-expanded={open} onClick={toggle}>
          <div className="slot-title">{task.name}</div>
          <div className="slot-meta" style={overdue ? { color: 'var(--danger)' } : undefined}>
            {[task.dueOn === today ? t.asanaDueToday : task.dueOn ?? t.asanaNoDate, task.project].filter(Boolean).join(' · ')}
          </div>
        </button>
      </div>

      {open && (
        <div className="task-panel">
          {controls?.map((control, i) => (
            <div className="field" key={`${control.type}-${control.fieldGid ?? control.label}`}>
              <label htmlFor={`st-${task.gid}-${i}`}>{control.type === 'section' ? `${t.asanaStatus} · ${control.label}` : control.label}</label>
              <select id={`st-${task.gid}-${i}`} value={control.current ?? ''} disabled={busy} onChange={(e) => setStatus(i, e.target.value)}>
                {!control.current && <option value="" disabled>—</option>}
                {control.options.map((o) => (
                  <option key={o.gid} value={o.gid}>{o.name}</option>
                ))}
              </select>
            </div>
          ))}
          {controls && controls.length === 0 && <p className="sub">{t.asanaNoStatus}</p>}
          <div className="field">
            <label htmlFor={`due-${task.gid}`}>{t.asanaDueDate}</label>
            <input id={`due-${task.gid}`} type="date" dir="ltr" value={task.dueOn ?? ''} disabled={busy} onChange={(e) => setDue(e.target.value)} />
          </div>
          {error && <div className="error" role="alert">{error}</div>}
          <a href={task.url} target="_blank" rel="noreferrer" className="link-btn">{t.asanaOpen}</a>
        </div>
      )}
    </div>
  );
}
