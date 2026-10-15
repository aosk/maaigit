import { useSettings } from '../settings';

/**
 * A small coloured number beside a section's title, so how much is in it is clear before it is opened.
 * The colour is the section's own (events blue, tasks orange, reminders purple, email red, WhatsApp green);
 * `alert` turns it red when something in the section is late. `of` shows "3/5" (what is left of what).
 */
export function CountBadge({ kind, n, of, alert, label }: { kind: 'event' | 'task' | 'reminder' | 'mail' | 'chat'; n: number; of?: number; alert?: boolean; label?: string }) {
  const { settings } = useSettings();
  const fmt = (x: number) => x.toLocaleString(settings.lang === 'ar' ? 'ar-SA' : 'en-GB');
  return (
    <span className={`count ${kind}${alert ? ' alert' : ''}${n === 0 ? ' zero' : ''}`} role="img" aria-label={label ?? (of !== undefined ? `${fmt(n)} / ${fmt(of)}` : fmt(n))}>
      {of !== undefined ? `${fmt(n)}/${fmt(of)}` : fmt(n)}
    </span>
  );
}
