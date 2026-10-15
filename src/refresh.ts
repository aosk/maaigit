import { useEffect, useRef } from 'react';
import { api } from './api';

/** Sent to every screen when the app is refreshed (pull down, or coming back after a while). */
const REFRESH_EVENT = 'maai:refresh';

/** Runs `reload` each time the app is refreshed. */
export function useOnRefresh(reload: () => void) {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    const handler = () => latest.current();
    window.addEventListener(REFRESH_EVENT, handler);
    return () => window.removeEventListener(REFRESH_EVENT, handler);
  }, []);
}

/**
 * Asks the server to re-read calendars, Asana and Gmail, then tells every screen to reload.
 * Resolves with what the server could not read (empty when all is well).
 */
export async function refreshAll(): Promise<string[]> {
  const result = await api.sync().catch(() => null);
  window.dispatchEvent(new Event(REFRESH_EVENT));
  // A sync that could not even be asked for is a problem, not "up to date".
  return result ? result.problems : ['offline'];
}
