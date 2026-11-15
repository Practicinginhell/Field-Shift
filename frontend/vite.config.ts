/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000" } },
  // Pre-bundling breaks MapLibre's web worker ("Worker failed to load").
  optimizeDeps: { exclude: ["maplibre-gl"] },
  test: { environment: "jsdom" },
});
