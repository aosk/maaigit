import { useEffect, useState } from 'react';
import { useSettings } from './settings';
import { Calendar, Chat, Gear, Inbox as InboxIcon, Newspaper } from './components/Icons';
import { Today } from './screens/Today';
import { Assistant } from './screens/Assistant';
import { Inbox } from './screens/Inbox';
import { News } from './screens/News';
import { SettingsScreen } from './screens/Settings';
import { Admin } from './admin/Admin';
import { ProfileScreen } from './screens/Profile';
import { Unlock } from './screens/Unlock';
import { LOCKED_EVENT, api } from './api';
import { AlertBanner } from './components/AlertBanner';
import { worker } from './push';
import { readRoute, type Route } from './nav';
import { useMailCount } from './useMailCount';
import { PullToRefresh } from './components/PullToRefresh';
import { refreshAll } from './refresh';
import { playChime } from './chime';

export function App() {
  const { t, settings } = useSettings();
  const [route, setRoute] = useState<Route>(readRoute);
  const [locked, setLocked] = useState<{ kind: 'pin' | 'password'; face: boolean } | null>(null);
  const unread = useMailCount();

  // The page being shown, for its own colours (the main page is pink).
  useEffect(() => {
    document.documentElement.dataset.page = route;
  }, [route]);

  // The service worker shows notifications; register it early so they work with the app closed.
  useEffect(() => {
    void worker();
  }, []);

  // Touching the screen keeps MAAI open: with Face ID set up the server locks it after a few minutes
  // without this (its own automatic refreshes do not count). Sent at most every 30 seconds.
  useEffect(() => {
    let last = Date.now();
    const touched = () => {
      if (Date.now() - last < 30_000 || document.hidden) return;
      last = Date.now();
      void api.active().catch(() => {});
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;
    for (const name of events) window.addEventListener(name, touched, { passive: true });
    return () => events.forEach((name) => window.removeEventListener(name, touched));
  }, []);

  // A push arriving while MAAI is open also plays MAAI's own chime.
  useEffect(() => {
    if (!settings.sound || !('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === 'chime') playChime();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [settings.sound]);

  // Coming back to the app after a while: refresh what it shows.
  useEffect(() => {
    let leftAt = 0;
    const onVisible = () => {
      if (document.hidden) leftAt = Date.now();
      else if (leftAt && Date.now() - leftAt > 10 * 60_000) void refreshAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    const onLocked = (e: Event) => {
      const detail = (e as CustomEvent).detail as { kind?: string; face?: boolean };
      setLocked({ kind: detail.kind === 'password' ? 'password' : 'pin', face: detail.face === true });
    };
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

  if (locked) return <Unlock kind={locked.kind} idle={locked.face} />;
  if (route === 'admin') return <Admin />;

  const tabs: { route: Route; label: string; icon: JSX.Element }[] = [
    { route: 'today', label: t.today, icon: <Calendar size={26} /> },
    { route: 'assistant', label: t.assistant, icon: <Chat size={26} /> },
    { route: 'inbox', label: t.inbox, icon: <InboxIcon size={26} /> },
    { route: 'news', label: t.news, icon: <Newspaper size={26} /> },
    { route: 'settings', label: t.settings, icon: <Gear size={26} /> },
  ];

  return (
    <div className="shell">
      <AlertBanner />
      <PullToRefresh onRefresh={refreshAll} disabled={route === 'assistant'} />
      <main>
        {route === 'today' && <Today />}
        {route === 'assistant' && <Assistant />}
        {route === 'inbox' && <Inbox />}
        {route === 'news' && <News />}
        {route === 'settings' && <SettingsScreen />}
        {route === 'profile' && <ProfileScreen />}
      </main>
      <nav className="tabs" aria-label={t.tabsLabel}>
        {tabs.map((tab) => (
          <a key={tab.route} className="tab" href={`#/${tab.route}`} aria-current={(route === 'profile' ? 'settings' : route) === tab.route ? 'page' : undefined}>
            {tab.icon}
            {tab.label}
            {tab.route === 'inbox' && unread ? <span className="tab-badge" aria-label={t.unreadEmails(unread)}>{unread > 99 ? '99+' : unread}</span> : null}
          </a>
        ))}
      </nav>
    </div>
  );
}
