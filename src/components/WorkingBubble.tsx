import { useState } from 'react';
import type { ChatEvent } from '../../shared/types';
import { useSettings } from '../settings';

export interface Progress {
  thinking: string;
  steps: { tool: string; detail?: string; done: boolean }[];
  text: string;
}

export const emptyProgress = (): Progress => ({ thinking: '', steps: [], text: '' });

/** Adds one live event to the progress. "read_email" starts a step; "read_email:done" finishes the oldest open one. */
export function addEvent(p: Progress, e: ChatEvent): Progress {
  if (e.type === 'thinking') return { ...p, thinking: p.thinking + e.text };
  if (e.type === 'text') return { ...p, text: p.text + e.text };
  const [tool, done] = e.tool.split(':');
  if (!done) return { ...p, steps: [...p.steps, { tool, done: false }] };
  const i = p.steps.findIndex((s) => s.tool === tool && !s.done);
  if (i < 0) return p;
  return { ...p, steps: p.steps.map((s, j) => (j === i ? { ...s, done: true, detail: e.detail } : s)) };
}

/** Shows what MAAI is doing right now: the current step, finished steps, its thinking, and the reply as it arrives. */
export function WorkingBubble({ progress }: { progress: Progress }) {
  const { t } = useSettings();
  const [showThinking, setShowThinking] = useState(false);
  const label = (tool: string) => t.stepLabels[tool as keyof typeof t.stepLabels] ?? t.working;
  const running = progress.steps.find((s) => !s.done);
  const headline = running ? label(running.tool) : progress.text ? t.writingReply : progress.thinking ? t.thinkingNow : t.thinking;

  return (
    <div className="bubble assistant working" aria-live="polite" aria-busy="true">
      <div className="working-head">
        <span className="spinner" aria-hidden="true" />
        <span>{headline}</span>
      </div>

      {progress.steps.length > 0 && (
        <ul className="steps">
          {progress.steps.map((s, i) => (
            <li key={i} className={s.done ? 'done' : ''}>
              <span aria-hidden="true">{s.done ? '✓' : '•'}</span>
              <span>
                {label(s.tool)}
                {s.detail && <span className="sub"> · {s.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {progress.thinking && (
        <div>
          <button className="link-btn" onClick={() => setShowThinking((v) => !v)} aria-expanded={showThinking}>
            {showThinking ? t.hideThinking : t.showThinking}
          </button>
          {showThinking && <div className="thinking-text" dir="auto">{progress.thinking}</div>}
        </div>
      )}

      {progress.text && <div className="working-text" dir="auto">{progress.text}</div>}
    </div>
  );
}
