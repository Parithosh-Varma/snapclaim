// SnapClaim service worker: the app shell opens on a bad connection.
// Version the cache; network-first for /v1 (never cache measurements),
// cache-first for the shell. No photo bytes are cached.
const CACHE = "snapclaim-shell-v4";
const SHELL = ["./", "./index.html", "./app.js", "./coin-model.js", "./photo-check.js", "./manifest.webmanifest",
  "./sam-worker.js", "./voice-worker.js", "./tilt-meter.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png"];

// Fix revision on top of CACHE: bump it to push a fix to installed phones without editing CACHE.
const CACHE_NAME = `${CACHE}-r1`;
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim(),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/v1/")) return; // measurements always hit the network
  event.respondWith(
    caches.match(event.request).then(
      (cached) => cached ?? fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      }),
    ),
  );
});
