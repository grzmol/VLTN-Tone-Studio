import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias: { "@shared": resolve("src/shared") } } },
  // The preload is CommonJS and sandboxed. A sandboxed preload can only
  // require "electron", "events", "timers" and "url", and cannot be an ES module, so keep shared code inlined here.
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: {
      rollupOptions: {
        input: { index: resolve("src/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    resolve: { alias: { "@": resolve("src/renderer/src"), "@shared": resolve("src/shared") } },
    plugins: [react(), tailwindcss()],
    worker: { format: 'es' },
    // onnxruntime-web (Song stem splitter worker) ships a ready ESM bundle; pre-bundling it on first use reloads the page.
    optimizeDeps: { exclude: ["onnxruntime-web"] },
  },
});
