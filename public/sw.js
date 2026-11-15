// Offline shell for the installed web app. Wardrobe data lives in IndexedDB, not here.
const CACHE = "capsule-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["./", "./manifest.webmanifest", "./icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Network first, cache fallback: updates arrive immediately, offline still opens.
  event.respondWith(fetch(request).then((response) => {
    if (response.ok && (request.mode === "navigate" || /\.(js|css|svg|png|webmanifest)$/.test(url.pathname))) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request).then((cached) => cached || (request.mode === "navigate" ? caches.match("./") : undefined))));
});
