// SnapClaim service worker: the app shell opens on a bad connection.
// Version the cache; network-first for /v1 (never cache measurements),
// cache-first for the shell. No photo bytes are cached.
const CACHE = "snapclaim-shell-v1";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim(),
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
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      }),
    ),
  );
});
