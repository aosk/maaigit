import { useState } from 'react';
import type { Team, TeamsView } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { toggleDay } from '../teamsLogic';
import { useAction } from '../useAction';

/** The teams: how many people each has, the days it is never messaged, rename, delete, and adding one. */
export function TeamList({ view, reload }: { view: TeamsView; reload: () => Promise<void> }) {
  const { t } = useSettings();
  const [name, setName] = useState('');
  const { busy, error, setError, run } = useAction();

  const add = () =>
    run(async () => {
      if (!name.trim()) return setError(t.tm.errName);
      await api.addTeam(name);
      setName('');
      await reload();
    });

  return (
    <section className="card" aria-labelledby="tm-teams-label">
      <span className="section-label" id="tm-teams-label" style={{ padding: 0 }}>{t.tm.teamsTitle}</span>
      {view.teams.length === 0 && <p className="sub">{t.tm.noTeams}</p>}
      <ul className="tm-list">
        {view.teams.map((team) => (
          <TeamRow key={team.id} team={team} count={view.members.filter((m) => m.teamIds.includes(team.id)).length} reload={reload} />
        ))}
      </ul>
      <form className="tm-inline" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <div className="field grow">
          <label htmlFor="tm-new-team">{t.tm.teamName}</label>
          <input id="tm-new-team" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="btn primary" type="submit" disabled={busy}>{t.tm.addTeam}</button>
      </form>
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}

function TeamRow({ team, count, reload }: { team: Team; count: number; reload: () => Promise<void> }) {
  const { t } = useSettings();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);
  const { busy, error, setError, run } = useAction();

  const patch = (body: { name?: string; offDays?: number[] }) =>
    run(async () => {
      await api.updateTeam(team.id, body);
      await reload();
      return true;
    });

  const rename = async () => {
    if (!name.trim()) return setError(t.tm.errName);
    if (await patch({ name })) setRenaming(false);
  };

  return (
    <li className="tm-item">
      {renaming ? (
        <form className="tm-inline" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
          <div className="field grow">
            <label htmlFor={`tm-rename-${team.id}`}>{t.tm.teamName}</label>
            <input id={`tm-rename-${team.id}`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn primary" type="submit" disabled={busy}>{t.tm.save}</button>
          <button className="btn ghost" type="button" onClick={() => { setRenaming(false); setName(team.name); setError(''); }}>{t.tm.cancel}</button>
        </form>
      ) : (
        <div className="tm-head">
          <strong className="tm-name"><bdi>{team.name}</bdi></strong>
          <span className="sub">{t.tm.people(count)}</span>
        </div>
      )}
      <div role="group" aria-label={t.tm.daysOff} className="tm-days">
        {t.tm.days.map((label, day) => (
          <button key={day} type="button" className="tm-day" aria-pressed={team.offDays.includes(day)} aria-label={t.tm.daysLong[day]} disabled={busy} onClick={() => void patch({ offDays: toggleDay(team.offDays, day) })}>
            {label}
          </button>
        ))}
      </div>
      <span className="sub">{t.tm.daysOff}</span>
      {!renaming && (
        <div className="row wrap">
          <button className="btn secondary" type="button" onClick={() => setRenaming(true)}>{t.tm.rename}</button>
          <button
            className="btn danger"
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t.tm.deleteTeamConfirm(team.name))) return;
              void run(async () => {
                await api.deleteTeam(team.id);
                await reload();
              });
            }}
          >
            {t.tm.delete}
          </button>
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </li>
  );
}
