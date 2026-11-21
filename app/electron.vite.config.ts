import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { pdfjsAssets } from "./scripts/pdfjs-assets";

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias: { "@shared": resolve("src/shared") } } },
  // Both preloads are CommonJS and sandboxed (the main window and the audience window). A sandboxed preload can only
  // require "electron", "events", "timers" and "url", and cannot be an ES module, so keep shared code inlined here.
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: {
      rollupOptions: {
        input: { index: resolve("src/preload/index.ts"), "audience-window": resolve("src/preload/audience-window.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    resolve: { alias: { "@": resolve("src/renderer/src"), "@shared": resolve("src/shared") } },
    plugins: [react(), tailwindcss(), pdfjsAssets()],
    // Two pages: the app, and the band follower page (spec 44), which band sync serves on the local network.
    build: { rollupOptions: { input: { index: resolve("src/renderer/index.html"), follower: resolve("src/renderer/follower.html") } } },
    worker: { format: 'es' },
    // onnxruntime-web (Song stem splitter worker) ships a ready ESM bundle; pre-bundling it on first use reloads the page.
    optimizeDeps: { exclude: ["onnxruntime-web", "@huggingface/transformers"] },
  },
});
