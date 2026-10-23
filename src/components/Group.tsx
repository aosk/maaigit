import { useState, type ReactNode } from 'react';
import { Chevron } from './Icons';

/**
 * A section of a long screen (Settings) that opens and closes, so the screen shows only the headings until one
 * is needed. Built on <details>, so it works with the keyboard and screen readers as is. Whether each one was
 * left open is remembered on this device.
 */
export function Group({ id, title, hint, defaultOpen = false, children }: { id: string; title: string; hint?: string; defaultOpen?: boolean; children: ReactNode }) {
  const key = `maai.open.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? defaultOpen : saved === '1';
    } catch {
      return defaultOpen;
    }
  });
  return (
    <details
      className="group"
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen(now);
        try {
          localStorage.setItem(key, now ? '1' : '0');
        } catch {
          // Not remembered (private mode): it still opens and closes.
        }
      }}
    >
      <summary className="group-head">
        <span>
          <strong>{title}</strong>
          {hint && <span className="sub group-hint">{hint}</span>}
        </span>
        <Chevron size={20} />
      </summary>
      <div className="group-body">{children}</div>
    </details>
  );
}
