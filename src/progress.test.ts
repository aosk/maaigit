import { describe, expect, it } from 'vitest';
import { addEvent, emptyProgress, thinkingTail } from './progress';

describe('what MAAI shows while it works', () => {
  it('rolls the end of the thinking, on one flat line, starting at a word', () => {
    expect(thinkingTail('short thought')).toBe('short thought');
    const long = `${'first part of the reasoning. '.repeat(10)}Now checking the calendar\nfor Thursday.`;
    const tail = thinkingTail(long);
    expect(tail.startsWith('…')).toBe(true);
    expect(tail.endsWith('Now checking the calendar for Thursday.')).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(141);
    expect(tail).not.toContain('\n');
  });

  it('adds each piece as it arrives: thinking, a step with what it found, then the answer', () => {
    let p = emptyProgress();
    p = addEvent(p, { type: 'thinking', text: 'Let me ' });
    p = addEvent(p, { type: 'thinking', text: 'look.' });
    p = addEvent(p, { type: 'step', tool: 'search_email' });
    expect(p.steps).toEqual([{ tool: 'search_email', done: false }]);
    p = addEvent(p, { type: 'step', tool: 'search_email:done', detail: 'contract (3)' });
    p = addEvent(p, { type: 'text', text: 'Found ' });
    p = addEvent(p, { type: 'text', text: 'three.' });
    expect(p).toEqual({ thinking: 'Let me look.', steps: [{ tool: 'search_email', done: true, detail: 'contract (3)' }], text: 'Found three.' });
  });
});
