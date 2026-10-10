/**
 * Cute - Service Worker
 * -----------------------------------
 * Scope: intentionally minimal and conservative. This exists ONLY to
 * satisfy PWA installability criteria and provide a basic offline
 * fallback shell - it must never change or interfere with live app
 * behaviour (auth, sockets, uploads, API calls).
 *
 * Strategy:
 *  - API calls (/api/*), Socket.IO (/socket.io/*) and uploaded files
 *    (/uploads/*) are NEVER intercepted - always go straight to the
 *    network, exactly as if no service worker existed.
 *  - Static shell assets (HTML/CSS/JS/icons) use network-first with a
 *    cache fallback, so the app still opens (read-only shell) when
 *    offline, but always prefers fresh content when online.
 */

// Bump this on every deploy that changes any file below (or any CSS/JS
// referenced by the HTML pages). Bumping it forces every already-installed
// PWA / mobile browser to drop its old cached shell on next load instead of
// silently keeping stale HTML/CSS/JS around - see the note on the static
// asset Cache-Control headers in server.js for the other half of this fix.
const CACHE_VERSION = 'cute-shell-v3';
const APP_SHELL = [
  '/',
  '/chat',
  '/css/style.css?v=2',
  '/js/api.js?v=2',
  '/js/ui-helpers.js?v=2',
  '/js/chat.js?v=2',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isBypassed(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    url.pathname.startsWith('/uploads/')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle simple GET navigations/assets - never touch POST/PUT/etc.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin (fonts CDN, etc.) and any live/data endpoints: pass through untouched.
  if (url.origin !== self.location.origin || isBypassed(url)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Keep the shell cache fresh, but don't let a failed clone break the response.
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/'))
      )
  );
});

/**
 * ------------------------------------------------------------------
 * Web Push - native/background notifications ("Cute Chat 💕")
 * ------------------------------------------------------------------
 * This is what lets a message notification show up even when the tab is
 * closed, minimized, or the whole browser is backgrounded - relying on the
 * open Socket.IO connection alone doesn't work once the OS suspends the
 * page's JS, so the backend also fires these through the Push service.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Cute Chat 💕';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    tag: data.tag, // same tag = same OS notification slot, so a burst of
    // messages from one chat updates/replaces in place instead of stacking
    renotify: false,
    data: data.data || {},
    vibrate: [80, 40, 80],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking the notification focuses an already-open tab (and tells it which
// chat to open) instead of always spawning a fresh window/reload.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/chat';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        if (new URL(client.url).origin === self.location.origin) {
          client.postMessage({ type: 'notification-click', url: targetUrl });
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});

// The browser can silently rotate a push subscription's endpoint at any
// time. Re-subscribing here keeps push working; the running app syncs the
// (possibly new) subscription back to the server on its next load via
// Push.init(), so no CSRF-protected POST needs to happen from inside the
// service worker itself.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldKey = event.oldSubscription ? event.oldSubscription.options.applicationServerKey : null;
        if (oldKey) {
          await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: oldKey });
        }
      } catch (e) {
        /* best effort - next app open will re-subscribe from scratch */
      }
    })()
  );
});
