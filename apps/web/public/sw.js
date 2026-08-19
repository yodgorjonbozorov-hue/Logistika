/*
 * Offline shell for TruckControl AI.
 *
 * Two rules, and only two:
 *   - the app shell (HTML, hashed JS/CSS/fonts) is served from the cache and
 *     refreshed in the background, so a phone on a weak link still opens;
 *   - anything that talks to the API is never cached — a dispatcher must not
 *     be shown yesterday's trips as if they were today's.
 */
const VERSION = 'tc-v1';
const SHELL = `${VERSION}-shell`;
const OFFLINE_URL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll([OFFLINE_URL, '/manifest.webmanifest'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** True for anything that must always come from the network. */
function isApiRequest(url) {
  return url.pathname.startsWith('/api/') || url.hostname !== self.location.hostname;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isApiRequest(url)) return; // straight to the network, uncached

  // Navigations: network first, cached shell as the offline fallback. The SPA
  // router then renders whatever route the URL asked for.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  // Hashed build assets never change under a given URL, so cache-first is safe
  // and makes a repeat open instant.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
