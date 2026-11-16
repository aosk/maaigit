import { useState } from 'react';
import type { Duty, TeamsView } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { dueFromInput, dueText, inputFromDue, plusDigits, splitDuties } from '../teamsLogic';
import { useAction } from '../useAction';

/** What is owed: the open follow-ups (finished ones folded away), and a small form for a new one. */
export function TeamDuties({ view, reload }: { view: TeamsView; reload: () => Promise<void> }) {
  const { t } = useSettings();
  const { open, finished } = splitDuties(view.duties);
  return (
    <>
      <section className="card" aria-labelledby="tm-duties-label">
        <span className="section-label" id="tm-duties-label" style={{ padding: 0 }}>{t.tm.dutiesTitle}</span>
        {open.length === 0 && <p className="sub">{t.tm.noDuties}</p>}
        <ul className="tm-list">
          {open.map((d) => <DutyRow key={d.id} duty={d} view={view} reload={reload} />)}
        </ul>
        {finished.length > 0 && (
          <details className="tm-finished">
            <summary>{t.tm.finished(finished.length)}</summary>
            <ul className="tm-list">
              {finished.map((d) => <DutyRow key={d.id} duty={d} view={view} reload={reload} />)}
            </ul>
          </details>
        )}
      </section>
      <NewDuty view={view} reload={reload} />
    </>
  );
}

function DutyRow({ duty, view, reload }: { duty: Duty; view: TeamsView; reload: () => Promise<void> }) {
  const { t, settings } = useSettings();
  const [moving, setMoving] = useState(false);
  const [when, setWhen] = useState(() => inputFromDue(duty.due));
  const { busy, error, setError, run } = useAction();
  const isOpen = duty.status === 'open' || duty.status === 'acknowledged' || duty.status === 'blocked';
  const team = view.teams.find((x) => x.id === duty.teamId);
  const last = duty.replies[duty.replies.length - 1];

  const change = (patch: { status?: 'done' | 'cancelled'; due?: string }) =>
    run(async () => {
      await api.updateDuty(duty.id, patch);
      setMoving(false);
      await reload();
    });

  const move = () => {
    const due = dueFromInput(when);
    if (!due) return setError(t.tm.errDue);
    return change({ due });
  };

  return (
    <li className="tm-item">
      <div className="tm-head">
        <strong className="tm-name">{duty.title}</strong>
        <span className={`tm-status ${duty.status}`}>{t.tm.status[duty.status]}</span>
      </div>
      <span className="sub tm-meta">
        <bdi>{duty.name}</bdi> <bdi dir="ltr">{plusDigits(duty.phone)}</bdi>
        {team && <> · <bdi>{team.name}</bdi></>}
      </span>
      <span className="sub">{t.tm.due}: {dueText(duty.due, settings.lang, { today: t.tm.today, tomorrow: t.tm.tomorrow })} · {t.tm.reminders(duty.reminders.length)}</span>
      {last && (
        <p className="tm-answer">
          <span className="sub">{t.tm.lastAnswer}: </span>
          <bdi dir="auto">{last.text}</bdi>
        </p>
      )}
      {moving ? (
        <form className="tm-inline" onSubmit={(e) => { e.preventDefault(); void move(); }}>
          <div className="field grow">
            <label htmlFor={`tm-move-${duty.id}`}>{t.tm.dueDate}</label>
            <input id={`tm-move-${duty.id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <button className="btn primary" type="submit" disabled={busy}>{t.tm.moveSave}</button>
          <button className="btn ghost" type="button" onClick={() => { setMoving(false); setError(''); }}>{t.tm.cancel}</button>
          <span className="sub tm-full">{t.tm.moveNote}</span>
        </form>
      ) : (
        <div className="row wrap">
          {isOpen && <button className="btn secondary" type="button" disabled={busy} onClick={() => void change({ status: 'done' })}>{t.tm.markDone}</button>}
          {isOpen && (
            <button className="btn danger" type="button" disabled={busy} onClick={() => { if (window.confirm(t.tm.cancelDutyConfirm(duty.title))) void change({ status: 'cancelled' }); }}>
              {t.tm.cancelDuty}
            </button>
          )}
          <button className="btn ghost" type="button" onClick={() => setMoving(true)}>{t.tm.moveDate}</button>
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </li>
  );
}

function NewDuty({ view, reload }: { view: TeamsView; reload: () => Promise<void> }) {
  const { t } = useSettings();
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [teamId, setTeamId] = useState('');
  const { busy, error, setError, run } = useAction();
  const member = view.members.find((m) => m.phone === phone);
  const teams = view.teams.filter((x) => member?.teamIds.includes(x.id));

  const add = () =>
    run(async () => {
      const due = dueFromInput(when);
      if (!member) return setError(t.tm.errPerson);
      if (!title.trim()) return setError(t.tm.errTitle);
      if (!due) return setError(t.tm.errDue);
      await api.addDuty({ title, phone: member.phone, due, ...(teamId && member.teamIds.includes(teamId) ? { teamId } : {}) });
      setTitle('');
      setWhen('');
      await reload();
    });

  return (
    <section className="card" aria-labelledby="tm-new-label">
      <span className="section-label" id="tm-new-label" style={{ padding: 0 }}>{t.tm.newDuty}</span>
      {view.members.length === 0 ? (
        <p className="sub">{t.tm.needPeopleFirst}</p>
      ) : (
        <form className="tm-form" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <div className="field">
            <label htmlFor="tm-d-person">{t.tm.person}</label>
            <select id="tm-d-person" value={phone} onChange={(e) => { setPhone(e.target.value); setTeamId(''); }}>
              <option value="">{t.tm.pickPerson}</option>
              {view.members.map((m) => <option key={m.phone} value={m.phone}>{m.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tm-d-title">{t.tm.whatTitle}</label>
            <input id="tm-d-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tm-d-due">{t.tm.dueDate}</label>
            <input id="tm-d-due" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          {teams.length > 1 && (
            <div className="field">
              <label htmlFor="tm-d-team">{t.tm.team}</label>
              <select id="tm-d-team" value={teamId || teams[0]?.id} onChange={(e) => setTeamId(e.target.value)}>
                {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
          )}
          <button className="btn primary" type="submit" disabled={busy}>{t.tm.addDuty}</button>
          {error && <div className="error" role="alert">{error}</div>}
        </form>
      )}
    </section>
  );
}
