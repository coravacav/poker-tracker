import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { serviceWorkerPrecache } from "./vite-plugins/serviceWorkerPrecache";

/** Names the build in client error reports: the CI commit, else the local one, else the build time. */
function buildId(): string {
  const commit = process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (commit) return commit.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return new Date().toISOString();
  }
}

export default defineConfig({
  define: { "import.meta.env.VITE_APP_BUILD": JSON.stringify(buildId()) },
  plugins: [react(), serviceWorkerPrecache({ entry: "src/pwa/serviceWorker.ts" })]
});
