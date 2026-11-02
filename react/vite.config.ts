import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Static PWA. Root-absolute base: the app is served at "/" and also at
// "/admin" (see public/_redirects), and a trailing-slash URL like /admin/
// must still resolve /assets/*. Subpath hosting is not supported by design.
export default defineConfig({
  base: "/",
  plugins: [
    react(),
    {
      // Stamp the built service worker so its bytes change on every deploy.
      // Browsers only re-install a worker whose script differs, so a fixed
      // sw.js left phones serving one old index.html forever.
      name: "stamp-sw",
      closeBundle() {
        const file = join("dist", "sw.js");
        const stamp = `\n// build ${new Date().toISOString()}\n`;
        writeFileSync(file, readFileSync(file, "utf8") + stamp);
      },
    },
  ],
  build: { outDir: "dist", assetsDir: "assets" },
});
