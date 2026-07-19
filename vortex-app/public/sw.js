/* Vortex SC service worker.
 * Goals:
 *  - Make the app installable (Add to Home Screen / Google Play TWA).
 *  - NEVER serve a stale app: navigations are network-first, cache is only an
 *    offline fallback. This preserves the "every deploy shows immediately" rule.
 *  - Cache static assets (icons, fonts, images) cache-first for speed/offline.
 *  - Never touch Supabase API calls — those must always hit the network.
 */
const VERSION = 'vortex-v1';
const APP_SHELL = 'vortex-shell-' + VERSION;
const STATIC = 'vortex-static-' + VERSION;
const OFFLINE_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL).then((cache) => cache.addAll([OFFLINE_URL])).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== APP_SHELL && k !== STATIC).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Only handle our own origin; let Supabase / third-party requests pass straight through.
  if (url.origin !== self.location.origin) return;

  // Navigations (loading the app): network-first, fall back to cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(APP_SHELL).then((c) => c.put(OFFLINE_URL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(OFFLINE_URL).then((r) => r || caches.match(req)))
    );
    return;
  }

  // Static assets: cache-first, then network (and cache the result).
  if (/\/(assets|fonts|images)\//.test(url.pathname) || /\.(png|jpg|jpeg|webp|svg|woff2?|ttf)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(STATIC).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // Everything else: straight network.
});

// ---- Push notifications ----------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { try { data = { body: event.data && event.data.text() }; } catch (e2) {} }
  const title = data.title || 'Vortex SC';
  const options = {
    body: data.body || '',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined,
    renotify: !!data.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
