// MAAI service worker: shows alerts sent by the MAAI server, even when the app is closed.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'MAAI', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'MAAI', {
      body: data.body || '',
      tag: data.tag,
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
      data: { url: data.url || '/' },
    }),
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
