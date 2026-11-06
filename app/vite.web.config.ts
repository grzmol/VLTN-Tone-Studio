// Browser build of the renderer (no Electron): same UI, WebMIDI in Chrome/Edge, host features fall back to the web host.
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { pdfjsAssets } from "./scripts/pdfjs-assets";

export default defineConfig({
  root: resolve("src/renderer"),
  resolve: { alias: { "@": resolve("src/renderer/src"), "@shared": resolve("src/shared") } },
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  worker: { format: 'es' },
  server: { port: 5790, strictPort: true },
  // onnxruntime-web (Song stem splitter worker) ships a ready ESM bundle; pre-bundling it on first use reloads the page.
  optimizeDeps: { exclude: ["onnxruntime-web", "@huggingface/transformers"] },
});
