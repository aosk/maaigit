import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A browser history that behaves like the real one for what this needs: entries with state, back, and popstate. */
function fakeHistory(lazy = false) {
  const entries: { state: unknown; url: string }[] = [{ state: null, url: '#/inbox' }];
  let at = 0;
  const listeners = new Set<() => void>();
  const fire = () => listeners.forEach((f) => f());
  const queued: (() => void)[] = [];
  const history = {
    get state() {
      return entries[at].state;
    },
    pushState(state: unknown) {
      entries.splice(at + 1);
      entries.push({ state, url: entries[at].url });
      at += 1;
    },
    replaceState(state: unknown) {
      entries[at].state = state;
    },
    go(n: number) {
      const move = () => {
        const to = at + n;
        if (to < 0 || to >= entries.length || n === 0) return;
        at = to;
        fire();
      };
      // A real browser moves a moment later, not inside the call.
      if (lazy) queued.push(move);
      else move();
    },
    back: () => history.go(-1),
    forward: () => history.go(1),
  };
  vi.stubGlobal('window', { history, addEventListener: (_: string, f: () => void) => listeners.add(f), removeEventListener: (_: string, f: () => void) => listeners.delete(f) });
  /** A move to another screen (a tab): a new entry with no view state. */
  const navigate = (url: string) => {
    entries.splice(at + 1);
    entries.push({ state: null, url });
    at += 1;
    fire();
  };
  const settle = () => { while (queued.length) queued.shift()!(); };
  return { history, navigate, settle, depth: () => at, url: () => entries[at].url };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('the phone\'s Back inside a screen', () => {
  it('closes the open view instead of leaving the screen', async () => {
    const h = fakeHistory();
    const { openStep } = await import('./back');
    let open = true;
    openStep(() => (open = false));
    expect(h.depth()).toBe(1);
    h.history.back();
    expect(open).toBe(false);
    expect(h.depth()).toBe(0);
    expect(h.url()).toBe('#/inbox'); // still on the same screen
  });

  it('closes views opened one inside another one at a time, the innermost first', async () => {
    const h = fakeHistory();
    const { openStep } = await import('./back');
    const closed: string[] = [];
    openStep(() => closed.push('message'));
    openStep(() => closed.push('reply'));
    h.history.back();
    expect(closed).toEqual(['reply']);
    h.history.back();
    expect(closed).toEqual(['reply', 'message']);
  });

  it('takes its step out again when the view is closed from its own button, so Back is never one behind', async () => {
    const h = fakeHistory();
    const { openStep } = await import('./back');
    const closed: string[] = [];
    const done = openStep(() => closed.push('by back'));
    done(); // the view's own back button
    expect(h.depth()).toBe(0);
    expect(closed).toEqual([]); // not closed a second time
    // and an outer view that is still open is not closed by that step
    const outer = openStep(() => closed.push('outer'));
    const inner = openStep(() => closed.push('inner'));
    inner();
    expect(closed).toEqual([]);
    expect(h.depth()).toBe(1);
    outer();
    expect(h.depth()).toBe(0);
  });

  it('does not undo a move to another screen when the view under it goes away', async () => {
    const h = fakeHistory();
    const { openStep } = await import('./back');
    let open = true;
    const done = openStep(() => (open = false));
    h.navigate('#/today'); // a tab was tapped while the message was open
    expect(open).toBe(false); // the view is gone with its screen
    done(); // its screen unmounts
    expect(h.url()).toBe('#/today');
    expect(h.depth()).toBe(2);
  });

  it('passes over the step of a view that is gone: one Back from the next screen shows the list, Forward returns', async () => {
    const h = fakeHistory();
    const { openStep } = await import('./back');
    openStep(() => {});
    h.navigate('#/today');
    h.history.back();
    expect(h.depth()).toBe(0); // not stuck on the message's old step
    expect(h.url()).toBe('#/inbox');
    h.history.forward();
    expect(h.url()).toBe('#/today');
    expect(h.depth()).toBe(2);
  });

  it('closes a view and the ones opened inside it with one step each when the outer one is closed', async () => {
    const h = fakeHistory();
    const { openStep } = await import('./back');
    const closed: string[] = [];
    const outer = openStep(() => closed.push('outer'));
    const inner = openStep(() => closed.push('inner'));
    outer(); // the tab was tapped again: back to the list
    inner();
    expect(closed).toEqual(['inner']);
    expect(h.depth()).toBe(0);
    // Back is not one behind: a new view still closes with one Back
    let open = true;
    openStep(() => (open = false));
    h.history.back();
    expect(open).toBe(false);
    expect(h.depth()).toBe(0);
  });

  it('closes a view once: Forward into its old step does not close anything again', async () => {
    const h = fakeHistory();
    const { openStep } = await import('./back');
    let closes = 0;
    openStep(() => (closes += 1));
    h.history.back();
    h.history.forward();
    h.history.back();
    expect(closes).toBe(1);
  });

  it('stays right when two views close one after the other before the browser has moved', async () => {
    const h = fakeHistory(true);
    const { openStep } = await import('./back');
    const closed: string[] = [];
    const outer = openStep(() => closed.push('outer'));
    const inner = openStep(() => closed.push('inner'));
    inner(); // the reply was sent: its sheet closes
    outer(); // and then the message
    h.settle();
    expect(h.depth()).toBe(0);
    expect(closed).toEqual([]);
    let open = true;
    openStep(() => (open = false));
    h.history.back();
    h.settle();
    expect(open).toBe(false);
    expect(h.depth()).toBe(0);
  });
});
