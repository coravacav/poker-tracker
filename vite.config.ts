import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { serviceWorkerPrecache } from "./vite-plugins/serviceWorkerPrecache";

export default defineConfig({
  plugins: [react(), serviceWorkerPrecache({ entry: "src/pwa/serviceWorker.ts" })]
});
