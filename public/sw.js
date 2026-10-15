// MAAI service worker: shows alerts sent by the MAAI server, even when the app is closed.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'MAAI', body: event.data ? event.data.text() : '' };
  }
  const reminder = data.kind === 'reminder' || data.kind === 'leave';
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'MAAI', {
        body: data.body || '',
        tag: data.tag,
        icon: '/apple-touch-icon.png',
        badge: '/apple-touch-icon.png',
        lang: data.lang === 'ar' ? 'ar' : 'en',
        dir: data.lang === 'ar' ? 'rtl' : 'ltr',
        timestamp: Date.now(),
        // Sound is the phone's own: these ask for the alert to sound again and to stay until it is seen.
        silent: false,
        renotify: Boolean(data.tag),
        requireInteraction: reminder,
        vibrate: [200, 100, 200],
        data: { url: data.url || '/' },
      }),
      // If MAAI is open, it plays its own short chime too (the phone's sound only plays when it is closed).
      self.clients.matchAll({ type: 'window' }).then((windows) => {
        for (const w of windows) if (w.visibilityState === 'visible') w.postMessage({ type: 'chime', kind: data.kind });
      }),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only ever open a page of this site, whatever the notification says.
  const wanted = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  const url = wanted.origin === self.location.origin ? wanted.href : self.location.origin + '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ('focus' in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
