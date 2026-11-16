import { useCallback, useEffect, useState } from 'react';
import type { TeamsView } from '../../shared/types';
import { api } from '../api';
import { ReminderSettings } from './ReminderSettings';
import { TeamDuties } from './TeamDuties';
import { TeamList } from './TeamList';
import { TeamPeople } from './TeamPeople';

/** Settings → My teams: the teams, the people in them, what they owe, and when MAAI reminds them. */
export function TeamsSettings() {
  const [view, setView] = useState<TeamsView | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      setView(await api.teams());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    api.teams().then(setView, (e: Error) => setError(e.message));
  }, []);

  if (!view) return error ? <div className="error" role="alert">{error}</div> : <div className="skeleton"><span /><span /></div>;
  return (
    <>
      {error && <div className="error" role="alert">{error}</div>}
      <TeamList view={view} reload={reload} />
      <TeamPeople view={view} reload={reload} />
      <TeamDuties view={view} reload={reload} />
      <ReminderSettings settings={view.settings} reload={reload} />
    </>
  );
}
