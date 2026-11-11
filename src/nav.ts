import { useEffect, useRef } from 'react';
import { unlockSpeech } from './speech';

/** Moving between screens. Hash routes (#/assistant) so links work without any server setup. */

export type Route = 'today' | 'assistant' | 'inbox' | 'stocks' | 'news' | 'settings' | 'profile' | 'admin';
const ROUTES: Route[] = ['today', 'assistant', 'inbox', 'stocks', 'news', 'settings', 'profile', 'admin'];

/** Sections of the admin portal; their links (#/admin/agents, or plain #agents) open the portal there. */
const ADMIN_SECTIONS = ['agents', 'usage', 'cloud', 'integrations', 'audit'] as const;

/** A request another screen asked the assistant to send on arrival. */
const PROMPT_KEY = 'maai.prompt';
/** Set by the mic button on Today: the assistant starts listening on arrival. */
const LISTEN_KEY = 'maai.listen';

export function readRoute(): Route {
  const name = window.location.hash.replace(/^#\/?/, '');
  if (name.startsWith('admin/') || (ADMIN_SECTIONS as readonly string[]).includes(name)) return 'admin';
  return ROUTES.includes(name as Route) ? (name as Route) : 'today';
}

// Kept for this visit; where the browser blocks storage (private mode, site data off), in memory instead.
const kept = new Map<string, string>();
function put(key: string, value: string) {
  kept.set(key, value);
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* in memory only */
  }
}
function take(key: string): string | undefined {
  let value = kept.get(key);
  kept.delete(key);
  try {
    value = sessionStorage.getItem(key) ?? value;
    sessionStorage.removeItem(key);
  } catch {
    /* in memory only */
  }
  return value;
}

function go(route: Route) {
  window.location.hash = `/${route}`;
}

/** Opens the assistant and sends `prompt` on arrival. */
export function askAssistant(prompt: string) {
  put(PROMPT_KEY, prompt);
  go('assistant');
}

/** Opens the assistant with the microphone already listening. */
export function talkToAssistant() {
  unlockSpeech();
  put(LISTEN_KEY, '1');
  go('assistant');
}

/** What the assistant was asked to do on arrival (read once). */
export function takeArrival(): { prompt?: string; listen: boolean } {
  const prompt = take(PROMPT_KEY);
  const listen = Boolean(take(LISTEN_KEY));
  return { prompt, listen };
}

/** Opens «رسائلك» showing only email or only WhatsApp. */
export function openInbox(view: 'email' | 'whatsapp') {
  try {
    sessionStorage.setItem('maai.inboxView', view);
  } catch {
    // it then opens on every source
  }
  go('inbox');
}

/** Tapping the tab of the screen you are on: the screen goes back to its start (e.g. «رسائلك» back to the list). */
const RETAP = 'maai:retap';

export function retap(route: Route) {
  window.dispatchEvent(new CustomEvent<Route>(RETAP, { detail: route }));
}

export function useOnRetap(route: Route, run: () => void) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<Route>).detail === route && latest.current();
    window.addEventListener(RETAP, on);
    return () => window.removeEventListener(RETAP, on);
  }, [route]);
}
