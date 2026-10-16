import { defineConfig, devices } from "@playwright/test";

// Browser tests (`bun run test:e2e`), run locally only. They start their own
// Vite dev server; the sharing tests also need the Convex dev deployment from
// `.env.local` with current functions (run `bunx convex dev`) and skip without it.
const PORT = 5181;

export default defineConfig({
  testDir: "e2e",
  // `.e2e.ts`, so Vitest's default `*.test.ts`/`*.spec.ts` pattern never picks these up.
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } }
  ],
  webServer: {
    command: `bunx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000
  }
});
