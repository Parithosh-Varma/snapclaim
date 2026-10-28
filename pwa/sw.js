// Keeps the capture app opening on a bad connection. App files are fetched
// fresh when the network answers (so a deploy shows up on the next load) and
// served from the cache when it does not. API calls and other origins (the
// backend, the transformers.js CDN, the model files, which transformers.js
// caches itself) are never touched.
const CACHE = "snapclaim-shell-v1";
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./coin-detect.js",
  "./photo-check.js",
  "./sam-worker.js",
  "./voice-worker.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("snapclaim-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/v1/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match("./index.html"))),
  );
});
