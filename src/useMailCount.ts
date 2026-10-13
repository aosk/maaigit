import { useEffect, useState } from 'react';
import { api } from './api';

/** Unread Gmail count (null when Gmail isn't connected), checked every 5 minutes. No AI involved. */
export function useMailCount(): number | null {
  const [unread, setUnread] = useState<number | null>(null);
  useEffect(() => {
    const check = () => api.mailCount().then((c) => setUnread(c.unread)).catch(() => {});
    void check();
    const timer = setInterval(check, 5 * 60_000);
    return () => clearInterval(timer);
  }, []);
  return unread;
}
