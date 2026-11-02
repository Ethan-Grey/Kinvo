// Phone notifications (ADR-0017). Loaded into the service worker that
// vite-plugin-pwa generates (see workbox.importScripts in vite.config.ts).
// The payload is built by supabase/functions/_shared/push.ts.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = {}
  }
  const title = typeof data.title === 'string' ? data.title : 'Kinvo'
  // Only ever open pages of this app, whatever the payload says.
  const url = typeof data.url === 'string' && new URL(data.url, self.location.origin).origin === self.location.origin
    ? data.url
    : '/'

  const jobs = [
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      data: { url },
    }),
  ]
  if (typeof data.badge === 'number' && self.navigator.setAppBadge) {
    jobs.push(data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge())
  }
  event.waitUntil(Promise.all(jobs).catch(() => {}))
})

// Tapping a notification opens Kinvo at the right loan, reusing an open window.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          return client.focus().then((focused) => ('navigate' in focused ? focused.navigate(url) : focused))
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
