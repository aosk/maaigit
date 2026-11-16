import { useState } from 'react';
import type { TeamMember, TeamsView } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { groupByTeam, plusDigits } from '../teamsLogic';
import { useAction } from '../useAction';
import { PersonForm } from './PersonForm';

/** The people, listed under their teams, with a form to add one. */
export function TeamPeople({ view, reload }: { view: TeamsView; reload: () => Promise<void> }) {
  const { t } = useSettings();
  const [editing, setEditing] = useState('');
  const { busy, error, run } = useAction();

  return (
    <section className="card" aria-labelledby="tm-people-label">
      <span className="section-label" id="tm-people-label" style={{ padding: 0 }}>{t.tm.peopleTitle}</span>
      {view.teams.length === 0 ? (
        <p className="sub">{t.tm.needTeamFirst}</p>
      ) : (
        <>
          {groupByTeam(view.teams, view.members).map(({ team, members }) => (
            <div key={team.id} className="tm-group">
              <strong className="tm-name"><bdi>{team.name}</bdi></strong>
              {members.length === 0 && <p className="sub">{t.tm.noPeopleInTeam}</p>}
              <ul className="tm-list">
                {members.map((m) => (
                  <li key={m.phone} className="tm-item">
                    {editing === `${team.id}:${m.phone}` ? (
                      <PersonForm teams={view.teams} person={m} onCancel={() => setEditing('')} onSaved={async () => { setEditing(''); await reload(); }} />
                    ) : (
                      <Person m={m} onEdit={() => setEditing(`${team.id}:${m.phone}`)} busy={busy} onRemove={(member) => {
                        if (!window.confirm(t.tm.removeConfirm(member.name))) return;
                        void run(async () => {
                          await api.deleteMember(member.phone);
                          await reload();
                        });
                      }} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {error && <div className="error" role="alert">{error}</div>}
          <div className="tm-group">
            <strong>{t.tm.addPerson}</strong>
            <PersonForm teams={view.teams} onSaved={reload} />
          </div>
        </>
      )}
    </section>
  );
}

function Person({ m, onEdit, onRemove, busy }: { m: TeamMember; onEdit: () => void; onRemove: (m: TeamMember) => void; busy: boolean }) {
  const { t } = useSettings();
  return (
    <>
      <div className="tm-head">
        <strong className="tm-name"><bdi>{m.name}</bdi></strong>
        <bdi dir="ltr" className="sub">{plusDigits(m.phone)}</bdi>
      </div>
      <div className="row wrap">
        <button className="btn secondary" type="button" onClick={onEdit}>{t.tm.edit}</button>
        <button className="btn danger" type="button" disabled={busy} onClick={() => onRemove(m)}>{t.tm.remove}</button>
      </div>
    </>
  );
}
