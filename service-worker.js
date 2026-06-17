const CACHE_NAME = 'animeverse-precache-v6';
const RUNTIME_CACHE = 'animeverse-runtime-cache-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './login.html',
  './profile.html',
  './details.html',
  './watched.html',
  './favorites.html',
  './mylist.html',
  './history.html',
  './watch.html',
  './style.css',
  './script.js',
  './profile.js',
  './watched.js',
  './favorites.js',
  './mylist.js',
  './history.js',
  './watch.js',
  './auth.js',
  './db.js',
  './guard.js',
  './api.js',
  './recommendations.js',
  './offline.html',
  './icon-192.png',
  './icon-512.png',
  './login-bg.jpg',
  './ai.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  const currentCaches = [CACHE_NAME, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return cacheNames.filter(cacheName => !currentCaches.includes(cacheName));
    }).then(cachesToDelete => {
      return Promise.all(cachesToDelete.map(cacheToDelete => {
        return caches.delete(cacheToDelete);
      }));
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Skip Firebase Auth, Firestore, and other third-party scripts that shouldn't be cached
  if (url.includes('firestore.googleapis.com') || url.includes('identitytoolkit') || url.includes('securetoken.googleapis.com') || url.includes('firebasejs')) {
    return;
  }

  const isApiRequest = url.includes('api.themoviedb.org') || url.includes('api.jikan.moe');
  const isImageRequest = url.includes('image.tmdb.org') || url.includes('images.jpg') || url.includes('cdn.myanimelist.net');

  if (isApiRequest || isImageRequest) {
    // API/Images Runtime Cache Strategy
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            // Stale-While-Revalidate for APIs: return fast, but fetch/update in background
            if (isApiRequest) {
              fetch(event.request).then(networkResponse => {
                if (networkResponse.status === 200) {
                  cache.put(event.request, networkResponse);
                }
              }).catch(() => {});
            }
            return cachedResponse;
          }

          // Cache-First for Images: fetch from network and cache
          return fetch(event.request).then(networkResponse => {
            if (networkResponse.status === 200) {
              return cache.put(event.request, networkResponse.clone()).then(() => networkResponse);
            }
            return networkResponse;
          }).catch(err => {
            if (isApiRequest) {
              return new Response(JSON.stringify({ error: "Offline fallback data" }), {
                headers: { 'Content-Type': 'application/json' }
              });
            }
          });
        });
      })
    );
  } else {
    // Static app assets (Precaching / Cache-First / Offline fallback)
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request).catch(() => {
          // If a page navigation fails, return offline page
          if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
            return caches.match('./offline.html');
          }
        });
      })
    );
  }
});
