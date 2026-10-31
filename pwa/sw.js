// SnapClaim service worker: the app shell opens on a bad connection.
// Version the cache; network-only for /v1 (never cache measurements),
// cache-first for the same-origin shell. No photo bytes are cached.
// Updates wait: the page shows #updateBar and posts SKIP_WAITING on Reload.
const CACHE = "snapclaim-shell-v23";
const SHELL = ["./", "./index.html", "./app.js", "./coin-model.js", "./photo-check.js", "./rle.js", "./store.js", "./theme.js", "./mask-ops.js", "./manifest.webmanifest",
  "./sam-worker.js", "./voice-worker.js", "./tilt-meter.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim(),
    ),
  );
});

self.addEventListener("message", (event) => {
  // Only the controlled page (same origin, via client postMessage) can trigger
  // an update — cross-origin pages cannot reach the service worker directly.
  if (event.data === "SKIP_WAITING" && event.source) self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return; // backend and CDN: network only
  if (url.pathname.startsWith("/v1/")) return; // measurements always hit the network
  event.respondWith(
    caches.match(event.request).then(
      // Serve the precached shell; never runtime-cache new responses.
      // Runtime caching let one MITM'd first load persistently poison app.js.
      (cached) => cached ?? fetch(event.request).catch(() => (event.request.mode === "navigate" ? caches.match("./index.html") : Response.error())),
    ),
  );
});
