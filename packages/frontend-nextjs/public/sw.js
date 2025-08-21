const CACHE = 'user-profile-app-v1';
const toCache = ['/', '/feed', '/profile'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(toCache)));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && (url.pathname.startsWith('/api/posts') || url.pathname.startsWith('/api/profiles'))) {
    event.respondWith(
      caches.match(event.request).then((resp) => {
        const fetchPromise = fetch(event.request).then((networkResp) => {
          const copy = networkResp.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return networkResp;
        }).catch(() => resp || new Response('[]', {status: 200}));
        return resp || fetchPromise;
      })
    );
  }
});
