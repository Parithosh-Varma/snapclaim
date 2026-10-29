// SnapClaim service worker: the app shell opens on a bad connection.
// Version the cache; network-first for /v1 (never cache measurements),
// cache-first for the shell. No photo bytes are cached. Private evidence
// (IndexedDB cases) is never touched here.
const CACHE = "snapclaim-shell-v11";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./ui.js", "./theme.js", "./store.js", "./coin-model.js", "./photo-check.js", "./manifest.webmanifest", "./logo.svg", "./icon-192.png", "./icon-512.png"];

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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  const proto = url.protocol;
  if (proto !== "http:" && proto !== "https:") return; // e.g. chrome-extension:// from desktop extensions
  if (url.pathname.startsWith("/v1/")) return; // measurements always hit the network
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).then(
        (res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return res;
        },
        () => caches.match("./index.html"),
      ),
    );
    return;
  }
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
