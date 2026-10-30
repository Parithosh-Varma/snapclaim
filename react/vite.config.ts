import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static PWA: relative base so the build can be served from any path on
// Cloudflare Pages, like the vanilla pwa/ directory it replaces.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", assetsDir: "assets" },
});
