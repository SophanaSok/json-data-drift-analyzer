import { defineConfig } from "@playwright/test";

const DEV_URL = "http://127.0.0.1:4173/json-data-drift-analyzer/";
const PREVIEW_URL = "http://127.0.0.1:4174/json-data-drift-analyzer/";

export default defineConfig({
  testDir: "./e2e",
  // A committed `.only` silently shrinks the suite to one test while CI stays
  // green — fail the build instead.
  forbidOnly: !!process.env.CI,
  // Retries tell flake apart from real failure; the trace from the first retry
  // is the evidence when it is real.
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "dev",
      testIgnore: /csp\.spec\.ts|detection\.spec\.ts/,
      use: { baseURL: DEV_URL }
    },
    {
      // Writes a temporary second profile into src/profiles/sources/ (see the
      // spec), which makes the dev server hot-reload every connected page —
      // so it must run AFTER the dev project's tests, never alongside them.
      // The built project is immune: preview serves static output.
      name: "detection",
      testMatch: /detection\.spec\.ts/,
      use: { baseURL: DEV_URL },
      dependencies: ["dev"]
    },
    {
      // The Content-Security-Policy is injected at build time only, so it can only
      // be exercised against the built output. Testing it on the dev server would
      // assert nothing.
      name: "built",
      testMatch: /csp\.spec\.ts/,
      use: { baseURL: PREVIEW_URL }
    }
  ],
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4173",
      url: DEV_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120000
    },
    {
      command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4174",
      url: PREVIEW_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120000
    }
  ]
});
