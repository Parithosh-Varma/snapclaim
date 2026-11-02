import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static PWA. Root-absolute base: the app is served at "/" and also at
// "/admin" (see public/_redirects), and a trailing-slash URL like /admin/
// must still resolve /assets/*. Subpath hosting is not supported by design.
//
// Landing branch: this config also builds the marketing multi-page site
// (index + how + case-study + faq share styles.css/theme.js/app.js).
// Main branch only ever has index.html, so the extra inputs are landing-only.
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const rootDir = dirname(fileURLToPath(import.meta.url));
const pages = ["index.html", "how.html", "case-study.html", "faq.html"];
// Extra pages exist on the landing branch only; on main only index.html
// builds. Filtering by existence keeps both branches green.
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
    rollupOptions: {
      input: Object.fromEntries(
        pages
          .filter((p) => existsSync(resolve(rootDir, p)))
          .map((p) => [p.replace(/\.html$/, ""), resolve(rootDir, p)]),
      ),
    },
  },
});
