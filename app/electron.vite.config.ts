import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias: { "@shared": resolve("src/shared") } } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias: { "@shared": resolve("src/shared") } } },
  renderer: {
    resolve: { alias: { "@": resolve("src/renderer/src"), "@shared": resolve("src/shared"), "@whisper-ort": resolve("node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist") } },
    plugins: [react(), tailwindcss()],
    worker: { format: 'es' },
    // onnxruntime-web (Song stem splitter worker) ships a ready ESM bundle; pre-bundling it on first use reloads the page.
    optimizeDeps: { exclude: ["onnxruntime-web", "@huggingface/transformers", "@whisper-ort/ort-wasm-simd-threaded.jsep.mjs?url"] },
  },
});
