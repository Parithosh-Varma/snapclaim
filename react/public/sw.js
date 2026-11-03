// SnapClaim (React build) service worker: the app shell opens on a bad
// connection. Version the cache; network-only for /v1 (never cache
// measurements), cache-first for the same-origin shell (Vite's hashed
// assets are immutable, so runtime cache-first is safe). No photo bytes
// are cached. Updates wait: the page shows #updateBar and posts
// SKIP_WAITING on Reload.
//
// Navigations are network-first on purpose. A cache-first index.html pinned
// phones to whatever build they first cached: every later deploy shipped a
// new hashed bundle the old HTML never referenced, so the app looked frozen
// no matter how many times it was reloaded. The HTML is the one file whose
// URL never changes, so it must come from the network when there is one.
const CACHE = "snapclaim-react-v22";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./hero-crack.jpg", "./snapclaim-mark.png", "./snapclaim-mark-dark.png",
  "./coin-model.js", "./theme.js", "./sam-worker.js", "./voice-worker.js",
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
  if (event.data === "SKIP_WAITING" && event.source) self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return; // backend and CDN: network only
  if (url.pathname.startsWith("/v1/")) return; // measurements always hit the network

  // The app shell HTML: always ask the network, fall back to the copy
  // precached at install when offline. Nothing is written at runtime.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("./index.html").then((cached) => cached ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      // Serve the precached shell; never runtime-cache (see pwa/sw.js).
      (cached) => cached ?? fetch(event.request).catch(() => Response.error()),
    ),
  );
});
