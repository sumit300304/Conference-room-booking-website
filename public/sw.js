// Minimal service worker: caches the static app shell so the installed
// app opens instantly, while all /api/ calls always go to the network
// (booking data must never be served stale).

const CACHE_NAME = 'algorisys-booking-shell-v19';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/images/auth-conference-bg.jpg',
  '/images/conference-hero.jpg',
  '/images/board-room.jpg',
  '/images/small-conference-room.jpg',
  '/images/conference-reserved.jpg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls - always hit the server so bookings/schedules
  // are always current and correctly enforced server-side.
  if (url.pathname.startsWith('/api/')) {
    return; // let the browser handle it normally (network)
  }

  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
