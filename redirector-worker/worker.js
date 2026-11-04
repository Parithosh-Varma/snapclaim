// Redirector worker: canonical-host redirect to MAIN (snapclaim.pages.dev).
// Scope: apex/custom domains -> MAIN. Never bound to MAIN itself (see guard below).
// NOTE: /reports PDFs are same-origin static and must never redirect.
// They are served directly from the same origin (no redirect through here).
const MAIN = "https://snapclaim.pages.dev";
export default {
  async fetch(request) {
    const url = new URL(request.url);
    // Already on main -> serve through, never redirect-loop (misconfig guard:
    // binding this worker to snapclaim.pages.dev/* would otherwise 301 forever).
    if (url.hostname === "snapclaim.pages.dev") {
      return fetch(request);
    }
    const target = MAIN + url.pathname + url.search;
    return Response.redirect(target, 301, {
      headers: {
        "cache-control": "public, max-age=86400",
        vary: "Host",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  }
};
