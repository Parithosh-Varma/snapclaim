import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../react/public/assets/player",
    emptyOutDir: true,
    lib: { entry: "src/main.tsx", formats: ["iife"], name: "SnapclaimPlayer", fileName: () => "player.js" },
  },
});
