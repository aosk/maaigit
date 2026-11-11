import { useEffect, useRef, useState } from 'react';
import { useSettings } from './settings';
import { Calendar, ChartUp, Chat, Gear, Inbox as InboxIcon } from './components/Icons';
import { Today } from './screens/Today';
import { Assistant } from './screens/Assistant';
import { Inbox } from './screens/Inbox';
import { News } from './screens/News';
import { StockSmart } from './screens/StockSmart';
import { SettingsScreen } from './screens/Settings';
import { Admin } from './admin/Admin';
import { ProfileScreen } from './screens/Profile';
import { Unlock } from './screens/Unlock';
import { LOCKED_EVENT, api } from './api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { forgetFeeds, idleTooLong } from './inboxCache';
import { AlertBanner } from './components/AlertBanner';
import { Wordmark } from './components/Logo';
import { worker } from './push';
import { readRoute, retap, type Route } from './nav';
import { useMailCount } from './useMailCount';
import { PullToRefresh } from './components/PullToRefresh';
import { refreshAll } from './refresh';
import { playChime } from './chime';

export function App() {
  const { t, settings } = useSettings();
  const [route, setRoute] = useState<Route>(readRoute);
  const [locked, setLocked] = useState<{ kind: 'pin' | 'password'; face: boolean } | null>(null);
  const unread = useMailCount();

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

  // On open, ask the server once whether the session is good. An answer lets the saved Inbox show; a 401 locks the
  // app; any other failure (offline, restarting) cannot tell a locked app from an open one, so nothing saved is shown.
  // Kept apart from the idle wipe below: the lock time comes from the same answer.
  const lockMinutes = useRef(30);
  useEffect(() => {
    api.status().then((s) => { lockMinutes.current = s.lockMinutes ?? 30; }).catch(() => forgetFeeds());
  }, []);

  // The server locks a Face ID app after `lockMinutes` without use, but only answers when asked. Offline, nothing
  // would ever ask, so the saved Inbox is also wiped here after the same time without a touch (or hidden that long).
  useEffect(() => {
    let last = Date.now();
    const touched = () => { if (!document.hidden) last = Date.now(); };
    const check = () => {
      if (!idleTooLong(last, Date.now(), lockMinutes.current)) return;
      last = Date.now();
      forgetFeeds();
      // Ask again: a locked app shows the lock screen; an open one fills the Inbox again.
      void api.status().catch(() => {});
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;
    for (const name of events) window.addEventListener(name, touched, { passive: true });
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, 30_000);
    return () => {
      for (const name of events) window.removeEventListener(name, touched);
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
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
      // Locked: the copy of the inbox kept on this device for a quick first paint is removed with the screen.
      forgetFeeds();
      setLocked({ kind: detail.kind === 'password' ? 'password' : 'pin', face: detail.face === true });
    };
    window.addEventListener(LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(LOCKED_EVENT, onLocked);
  }, []);

  useEffect(() => {
    const onHash = () => {
      const next = readRoute();
      // Where to go back to from the admin portal: the screen it was opened from.
      if (next === 'admin' && route !== 'admin') {
        try {
          sessionStorage.setItem('maai.beforeAdmin', route);
        } catch {
          // private mode: the portal goes back to «يومك»
        }
      }
      setRoute(next);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [route]);

  useEffect(() => {
    document.title = route === 'admin' ? 'MAAI Admin' : `${t.appName} · ${t[route]}`;
  }, [route, t]);

  if (locked) return <Unlock kind={locked.kind} idle={locked.face} />;
  if (route === 'admin') return <ErrorBoundary resetKey="admin"><Admin /></ErrorBoundary>;

  const tabs: { route: Route; label: string; icon: JSX.Element }[] = [
    { route: 'today', label: t.today, icon: <Calendar size={26} /> },
    { route: 'assistant', label: t.assistant, icon: <Chat size={26} /> },
    { route: 'inbox', label: t.inbox, icon: <InboxIcon size={26} /> },
    // StockSmart takes the news's place in the bar; the news opens from «يومك».
    { route: 'stocks', label: t.stocks, icon: <ChartUp size={26} /> },
    { route: 'settings', label: t.settings, icon: <Gear size={26} /> },
  ];

  return (
    <div className="shell">
      <AlertBanner />
      <PullToRefresh onRefresh={refreshAll} disabled={route === 'assistant'} />
      <main>
        <ErrorBoundary resetKey={route}>
          {route === 'today' && <Today />}
          {route === 'assistant' && <Assistant />}
          {route === 'inbox' && <Inbox />}
          {route === 'news' && <News />}
          {route === 'stocks' && <StockSmart />}
          {route === 'settings' && <SettingsScreen />}
          {route === 'profile' && <ProfileScreen />}
        </ErrorBoundary>
      </main>
      <nav className="tabs" aria-label={t.tabsLabel}>
        <div className="tabs-brand"><Wordmark width={112} title={`${t.appName} | maai`} /></div>
        {tabs.map((tab) => (
          <a
            key={tab.route}
            className="tab"
            href={`#/${tab.route}`}
            onClick={(e) => {
              // Already here: no navigation happens, so tell the screen to go back to its start, and scroll up.
              if (route !== tab.route) return;
              e.preventDefault();
              retap(tab.route);
              window.scrollTo({ top: 0, behavior: document.documentElement.dataset.motion === 'reduce' ? 'auto' : 'smooth' });
            }}
            aria-current={(route === 'profile' ? 'settings' : route) === tab.route ? 'page' : undefined}>
            {tab.icon}
            {tab.label}
            {tab.route === 'inbox' && unread ? <span className="tab-badge" aria-label={t.unreadEmails(unread)}>{unread > 99 ? '99+' : unread}</span> : null}
          </a>
        ))}
      </nav>
    </div>
  );
}
