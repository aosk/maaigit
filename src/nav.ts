/** Moving between screens. Hash routes (#/assistant) so links work without any server setup. */

export type Route = 'today' | 'assistant' | 'inbox' | 'news' | 'settings' | 'admin';
const ROUTES: Route[] = ['today', 'assistant', 'inbox', 'news', 'settings', 'admin'];

/** Sections of the admin portal; their links (#/admin/agents, or plain #agents) open the portal there. */
const ADMIN_SECTIONS = ['agents', 'usage', 'integrations', 'audit'] as const;

/** A request another screen asked the assistant to send on arrival. */
const PROMPT_KEY = 'maai.prompt';
/** Set by the mic button on Today: the assistant starts listening on arrival. */
const LISTEN_KEY = 'maai.listen';

export function readRoute(): Route {
  const name = window.location.hash.replace(/^#\/?/, '');
  if (name.startsWith('admin/') || (ADMIN_SECTIONS as readonly string[]).includes(name)) return 'admin';
  return ROUTES.includes(name as Route) ? (name as Route) : 'today';
}

function go(route: Route) {
  window.location.hash = `/${route}`;
}

/** Opens the assistant and sends `prompt` on arrival. */
export function askAssistant(prompt: string) {
  sessionStorage.setItem(PROMPT_KEY, prompt);
  go('assistant');
}

/** Opens the assistant with the microphone already listening. */
export function talkToAssistant() {
  sessionStorage.setItem(LISTEN_KEY, '1');
  go('assistant');
}

/** What the assistant was asked to do on arrival (read once). */
export function takeArrival(): { prompt?: string; listen: boolean } {
  const prompt = sessionStorage.getItem(PROMPT_KEY) ?? undefined;
  const listen = Boolean(sessionStorage.getItem(LISTEN_KEY));
  sessionStorage.removeItem(PROMPT_KEY);
  sessionStorage.removeItem(LISTEN_KEY);
  return { prompt, listen };
}

/** Opens the Inbox on its Email or WhatsApp tab. */
export function openInbox(view: 'email' | 'whatsapp') {
  try {
    sessionStorage.setItem('maai.inboxView', view);
  } catch {
    // the tab then opens on Email
  }
  go('inbox');
}
