import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useOnRefresh } from './refresh';

/** Unread Gmail count (null when Gmail isn't connected), checked every 5 minutes. No AI involved. */
export function useMailCount(): number | null {
  const [unread, setUnread] = useState<number | null>(null);
  const check = useCallback(() => api.mailCount().then((c) => setUnread(c.unread)).catch(() => {}), []);
  useEffect(() => {
    void check();
    const timer = setInterval(check, 5 * 60_000);
    return () => clearInterval(timer);
  }, [check]);
  useOnRefresh(() => void check());
  return unread;
}
