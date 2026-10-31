import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static PWA. Root-absolute base: the app is served at "/" and also at
// "/admin" (see public/_redirects), and a trailing-slash URL like /admin/
// must still resolve /assets/*. Subpath hosting is not supported by design.
export default defineConfig({
  base: "/",
  plugins: [react()],
  build: { outDir: "dist", assetsDir: "assets" },
});
