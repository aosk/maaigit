import { useCallback, useEffect, useState } from 'react';
import type { AsanaControl, AsanaOverview, AsanaProject, AsanaTask } from '../../shared/types';
import { api, type NewAsanaTask } from '../api';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { useOnRefresh } from '../refresh';
import { Plus } from './Icons';
import { AsanaNewFields } from './AsanaNewFields';
import { CountBadge } from './CountBadge';

/** How many tasks show before "Show more". */
const SHOWN = 8;
const EMPTY: NewAsanaTask = { name: '', notes: '', dueOn: '', projectGid: '' };
const todayDate = () => new Date().toLocaleDateString('en-CA');

/** Your Asana tasks on Today: tick to finish, tap one to change its status or date, or add a new one. */
export function AsanaTasks() {
  const { t } = useSettings();
  const [data, setData] = useState<AsanaOverview | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewAsanaTask>(EMPTY);
  const [projects, setProjects] = useState<AsanaProject[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [finished, setFinished] = useState<AsanaTask | null>(null);
  const [created, setCreated] = useState<AsanaTask | null>(null);
  const { busy, error, run } = useAction();

  const [loadError, setLoadError] = useState('');
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<string[] | null>(null);
  const load = useCallback(
    () =>
      api
        .asana()
        .then((d) => {
          setData(d);
          setLoadError('');
        })
        .catch((e: Error) => setLoadError(e.message)),
    [],
  );

  /** "Check Asana": shows what MAAI can see, or why it cannot see anything. */
  const check = async () => {
    setChecking(true);
    setReport(null);
    try {
      const r = await api.asanaCheck();
      setReport([
        t.asanaCheckUser(r.user),
        ...r.workspaces.map((w) => t.asanaCheckWorkspace(w.name, w.open)),
        t.asanaCheckShown(r.shown),
        ...(r.error ? [t.asanaError(r.error)] : []),
      ]);
    } catch (e) {
      setReport([(e as Error).message]);
    } finally {
      setChecking(false);
    }
  };
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

  if (!data) {
    // Never vanish without a word: say that it is loading, or why it could not be loaded.
    return (
      <>
        <div className="between wrap"><h2 className="h2 sec sec-task">{t.asanaTasks}</h2></div>
        {loadError ? (
          <div className="card soft" role="alert">
            <span className="sub">{t.asanaLoadFailed(loadError)}</span>
            <div className="row">
              <button className="btn secondary round" onClick={() => void load()}>{t.asanaRetry}</button>
              <button className="btn ghost round" onClick={check} disabled={checking}>{checking ? t.asanaChecking : t.asanaCheck}</button>
            </div>
            {report && <ul className="sub" style={{ margin: 0, paddingInlineStart: 18 }}>{report.map((line) => <li key={line}>{line}</li>)}</ul>}
          </div>
        ) : (
          <div className="skeleton" aria-label={t.loading}><span /><span /></div>
        )}
      </>
    );
  }

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
      <div className="between wrap">
        <h2 className="h2 sec sec-task">{t.asanaTasks}{data.configured && !data.error && <CountBadge kind="task" n={data.open} alert={data.overdue > 0} />}</h2>
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
        <section className="card" aria-label={t.asanaNewTitle}>
          <AsanaNewFields idPrefix="today-new" value={draft} projects={projects} disabled={busy} onChange={setDraft} />
          <div className="row">
            <button className="btn primary big" style={{ flex: 2 }} disabled={busy || !draft.name.trim()} onClick={create}>{busy ? t.sending : t.asanaCreate}</button>
            <button className="btn ghost big grow" onClick={() => setAdding(false)}>{t.cancel}</button>
          </div>
        </section>
      )}

      {error && <div className="error" role="alert">{error}</div>}
      {created && !adding && (
        <div className="undo-bar" role="status">
          <span>✓ {t.asanaCreated}: {created.name}</span>
          <a href={created.url} target="_blank" rel="noreferrer" className="link-btn">{t.asanaOpen}</a>
        </div>
      )}
      {finished && (
        <div className="undo-bar" role="status">
          <span>✓ {t.asanaMarkedDone(finished.name)}</span>
          <button className="link-btn" onClick={() => undo(finished)}>{t.undo}</button>
        </div>
      )}

      {note ? (
        <div className="card soft">
          <a href="#/settings" style={{ textDecoration: 'none', color: 'inherit' }}><span className="sub">{note}</span></a>
          {data.configured && (
            <>
              <div className="row">
                <button className="btn secondary round" onClick={check} disabled={checking}>{checking ? t.asanaChecking : t.asanaCheck}</button>
              </div>
              {report && <ul className="sub" style={{ margin: 0, paddingInlineStart: 18 }}>{report.map((line) => <li key={line}>{line}</li>)}</ul>}
            </>
          )}
        </div>
      ) : (
        data.tasks.length > 0 && (
          <section className="card flush" aria-label={t.asanaTasks}>
            {(showAll ? data.tasks : data.tasks.slice(0, SHOWN)).map((task) => (
              <TaskRow key={task.gid} task={task} disabled={busy} onComplete={() => complete(task)} onChanged={load} />
            ))}
            {data.tasks.length > SHOWN && (
              <button className="slot earlier" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
                <span className="sub">{showAll ? t.asanaShowLess : t.asanaShowMore(data.tasks.length - SHOWN)}</span>
              </button>
            )}
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
