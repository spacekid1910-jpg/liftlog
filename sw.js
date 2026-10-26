// Network-first service worker: always tries the live site, falls back to cache when offline (e.g. at the gym).
const CACHE = 'liftlog-shell-v2';
const SHELL = [
  './',
  'index.html',
  'styles.css?v=1',
  'app.js?v=1',
  'data.js?v=1',
  'charts.js?v=1',
  'manifest.webmanifest',
  'icons/icon-192.png?v=1',
  'icons/icon-512.png?v=1',
  'icons/apple-touch-icon.png?v=1',
  'icons/favicon-32.png?v=1',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
