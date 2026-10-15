import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../settings';

/** How far the page must be pulled (after the finger's pull is eased) to refresh. */
const THRESHOLD = 64;
const MAX = 110;
const EASE = 0.6;

type Phase = 'idle' | 'pulling' | 'ready' | 'refreshing' | 'done' | 'problem';

/**
 * Pull down at the top of a screen to refresh. Installed iPhone apps have no built-in
 * pull-to-refresh, so this adds one: it only shows the indicator; `onRefresh` does the work
 * and returns what could not be updated.
 */
export function PullToRefresh({ onRefresh, disabled }: { onRefresh: () => Promise<string[]>; disabled?: boolean }) {
  const { t } = useSettings();
  const [pull, setPull] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    if (disabled) return;
    let startY: number | null = null;
    let distance = 0;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const reset = () => {
      startY = null;
      distance = 0;
      setPull(0);
      setPhase('idle');
    };

    const onStart = (e: TouchEvent) => {
      if (busy || window.scrollY > 0 || e.touches.length !== 1) return;
      // Typing, pickers and open sheets keep their own touches.
      if ((e.target as Element | null)?.closest('input, textarea, select, [role="dialog"]')) return;
      startY = e.touches[0].clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) return reset();
      if (e.cancelable) e.preventDefault(); // stops the page's own rubber-band while we pull
      distance = Math.min(MAX, dy * EASE);
      setPull(distance);
      setPhase(distance >= THRESHOLD ? 'ready' : 'pulling');
    };

    const onEnd = async () => {
      if (startY === null) return;
      const pulled = distance;
      startY = null;
      if (pulled < THRESHOLD) return reset();
      busy = true;
      setPull(THRESHOLD);
      setPhase('refreshing');
      const problems = await refresh.current().catch(() => ['refresh']);
      setPhase(problems.length ? 'problem' : 'done');
      setPull(THRESHOLD);
      timer = setTimeout(() => {
        busy = false;
        reset();
      }, problems.length ? 2600 : 900);
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', reset);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', reset);
      clearTimeout(timer);
      // Leaving mid-refresh must not strand the "done" pill on screen.
      busy = false;
      reset();
    };
  }, [disabled]);

  if (phase === 'idle') return null;
  const label = { pulling: t.pullToRefresh, ready: t.releaseToRefresh, refreshing: t.refreshing, done: t.upToDate, problem: t.refreshProblems, idle: '' }[phase];
  return (
    <div className="ptr" style={{ transform: `translate(-50%, ${pull - 56}px)`, opacity: Math.min(1, pull / 40) }} role="status" aria-live="polite">
      {phase === 'refreshing' && <span className="spinner" aria-hidden="true" />}
      {(phase === 'pulling' || phase === 'ready') && <span aria-hidden="true" className="ptr-arrow" style={{ transform: phase === 'ready' ? 'rotate(180deg)' : undefined }}>↓</span>}
      {phase === 'done' && <span aria-hidden="true">✓</span>}
      {phase === 'problem' && <span aria-hidden="true">⚠</span>}
      <span>{label}</span>
    </div>
  );
}
