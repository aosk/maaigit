import { useEffect, useState } from 'react';
import { useSettings } from './settings';
import { Calendar, Chat, Gear, Inbox as InboxIcon } from './components/Icons';
import { Today } from './screens/Today';
import { Assistant } from './screens/Assistant';
import { Inbox } from './screens/Inbox';
import { SettingsScreen } from './screens/Settings';
import { Admin } from './admin/Admin';
import { Unlock } from './screens/Unlock';
import { LOCKED_EVENT } from './api';
import { AlertBanner } from './components/AlertBanner';
import { worker } from './push';

export type Route = 'today' | 'assistant' | 'inbox' | 'settings' | 'admin';
const ROUTES: Route[] = ['today', 'assistant', 'inbox', 'settings', 'admin'];

function readRoute(): Route {
  const name = window.location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(name) ? name : 'today';
}

/** Hash routes (#/assistant) so links work without any server setup. */
export function go(route: Route, prompt?: string) {
  if (prompt) sessionStorage.setItem(PROMPT_KEY, prompt);
  window.location.hash = `/${route}`;
}

/** A request another screen asked the assistant to send on arrival. */
export const PROMPT_KEY = 'maai.prompt';

export function App() {
  const { t } = useSettings();
  const [route, setRoute] = useState<Route>(readRoute);
  const [locked, setLocked] = useState<'pin' | 'password' | null>(null);

  // The service worker shows notifications; register it early so they work with the app closed.
  useEffect(() => {
    void worker();
  }, []);

  useEffect(() => {
    const onLocked = (e: Event) => setLocked((e as CustomEvent).detail === 'password' ? 'password' : 'pin');
    window.addEventListener(LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(LOCKED_EVENT, onLocked);
  }, []);

  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = route === 'admin' ? 'MAAI Admin' : `MAAI · ${t[route]}`;
  }, [route, t]);

  if (locked) return <Unlock kind={locked} />;
  if (route === 'admin') return <Admin />;

  const tabs: { route: Route; label: string; icon: JSX.Element }[] = [
    { route: 'today', label: t.today, icon: <Calendar size={26} /> },
    { route: 'assistant', label: t.assistant, icon: <Chat size={26} /> },
    { route: 'inbox', label: t.inbox, icon: <InboxIcon size={26} /> },
    { route: 'settings', label: t.settings, icon: <Gear size={26} /> },
  ];

  return (
    <div className="shell">
      <AlertBanner />
      <main>
        {route === 'today' && <Today />}
        {route === 'assistant' && <Assistant />}
        {route === 'inbox' && <Inbox />}
        {route === 'settings' && <SettingsScreen />}
      </main>
      <nav className="tabs" aria-label="Tabs">
        {tabs.map((tab) => (
          <a key={tab.route} className="tab" href={`#/${tab.route}`} aria-current={route === tab.route ? 'page' : undefined}>
            {tab.icon}
            {tab.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
