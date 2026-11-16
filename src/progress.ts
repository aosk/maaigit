import type { ChatEvent } from '../shared/types';

/** What MAAI has shown so far while it works on one answer. No screen code here, so it can be tested alone. */
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

/** The last couple of lines of the thinking so far, for the line that rolls while MAAI works. */
export const thinkingTail = (thinking: string, max = 140): string => {
  const flat = thinking.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const tail = flat.slice(-max);
  const space = tail.indexOf(' ');
  return `…${space >= 0 && space < 24 ? tail.slice(space + 1) : tail}`;
};
