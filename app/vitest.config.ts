import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve("src/renderer/src"), "@shared": resolve("src/shared") } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    // Node 25+ has its own global localStorage, which hides jsdom's and breaks every test that stores something.
    execArgv: ["--no-experimental-webstorage"],
  },
});
