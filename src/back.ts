import { useEffect, useRef } from 'react';

/**
 * Makes a view opened inside a screen (a message, the reply sheet, the Sent list, an event) part of the phone's Back.
 * Opening it adds one step to the browser's history; Back (the button, or the swipe from the edge on an iPhone) then
 * closes that view instead of leaving the whole screen. Views opened one inside another close one at a time, the
 * innermost first. Closing a view from its own button takes its step out again, so Back never ends up one behind.
 *
 * Every history entry also gets a running number, so a later Back or Forward that lands on the step of a view that is
 * no longer open (its screen was left by a tab) is known by its direction and passed over instead of doing nothing.
 */

interface Open {
  marker: string;
  close: () => void;
}
interface Mark {
  maaiSub?: string;
  maaiAt?: number;
}

const stack: Open[] = [];
let listening = false;
/** Moves this module itself asked for (a view closed from its own button): those must not close anything else. */
let ownSteps = 0;
let seq = 0;
/** The running number of the entry the app is on. */
let at = 0;
/** Markers from an earlier load of the page never match: each load has its own prefix. */
const load = Date.now().toString(36);

/** The view step history is on, or will be on once the moves this module asked for have happened (they come late). */
let onStep: string | undefined;

const mark = (): Mark => (window.history.state as Mark | null) ?? {};

function onMove() {
  const state = mark();
  if (state.maaiAt === undefined) {
    // A new entry (a tab, a link): number it. The views of the screen that was left are gone with it.
    at += 1;
    window.history.replaceState({ ...state, maaiAt: at }, '');
    while (stack.length) stack.pop()!.close();
    onStep = undefined;
    ownSteps = 0;
    return;
  }
  const from = at;
  at = state.maaiAt;
  if (ownSteps > 0) {
    if (from !== at) ownSteps -= 1;
    return;
  }
  if (from === at) return; // the same move, heard a second time
  onStep = state.maaiSub;
  // Every open view whose step is no longer the current one was just stepped out of: innermost first.
  while (stack.length && stack[stack.length - 1].marker !== state.maaiSub) stack.pop()!.close();
  // The step of a view that is not open any more: keep going the way the person was going.
  if (state.maaiSub && !stack.length) {
    if (from > at) window.history.back();
    else window.history.forward();
  }
}

function listen() {
  if (listening) return;
  listening = true;
  const state = mark();
  at = state.maaiAt ?? 0;
  // After a reload on a view's step, that view is not open: the entry is a plain one now.
  if (state.maaiAt === undefined || state.maaiSub) window.history.replaceState({ maaiAt: at }, '');
  window.addEventListener('popstate', onMove);
  // Not every browser sends popstate for a new #/screen; hashchange always comes.
  window.addEventListener('hashchange', onMove);
}

/** Call once when the app starts, so entries are numbered from the first screen. */
export function watchHistory(): void {
  listen();
}

/** Opens a step for a view; returns the function that takes it away when the view closes by itself. */
export function openStep(close: () => void): () => void {
  listen();
  const marker = `${load}.${++seq}`;
  stack.push({ marker, close });
  at += 1;
  window.history.pushState({ maaiSub: marker, maaiAt: at }, '');
  onStep = marker;
  return () => {
    const mine = stack.findIndex((o) => o.marker === marker);
    if (mine < 0) return; // Back already closed it
    // Views opened inside this one go with it.
    const gone = stack.splice(mine);
    const on = gone.findIndex((o) => o.marker === onStep);
    for (const inner of gone.slice(1)) inner.close();
    // Still on one of those steps (closed from its own button): step back out of them. After a move to another
    // screen the steps are somewhere behind in history, and stepping back would undo that move: left alone.
    if (on >= 0) {
      ownSteps += 1;
      onStep = stack[stack.length - 1]?.marker;
      window.history.go(-(on + 1));
    }
  };
}

/** While `open` is true, the phone's Back closes this view (see above). */
export function useBackCloses(open: boolean, close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!open) return;
    return openStep(() => latest.current());
  }, [open]);
}
