import { defineConfig } from "@playwright/test";

// End-to-end tests for the critical flows. They run the production build of
// the client (vite preview on :4173) against the local API, with the demo
// data loaded:
//
//   docker compose up -d postgres           (repo root)
//   cd server && npm run db:seed
//   cd client && npm run e2e
//
// A running API on :5000 is reused; otherwise it's started. Set E2E_BASE_URL
// to test an already running client instead (e.g. the dev server on :5173).
// Uses the installed Chrome (no browser download); set E2E_CHANNEL=chromium
// after `npx playwright install chromium` to use Playwright's own build.
export default defineConfig({
  testDir: "./e2e",
  // Generous: these check behaviour, not speed, and must pass on slow machines.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4173",
    channel: process.env.E2E_CHANNEL ?? "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        { command: "npm run dev", cwd: "../server", url: "http://localhost:5000/health", reuseExistingServer: true, timeout: 120_000 },
        { command: "npm run build && npx vite preview --port 4173 --strictPort", url: "http://localhost:4173", reuseExistingServer: true, timeout: 300_000 },
      ],
});
