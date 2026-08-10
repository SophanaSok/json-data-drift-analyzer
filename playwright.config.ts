import { defineConfig } from "@playwright/test";

const DEV_URL = "http://127.0.0.1:4173/json-data-drift-analyzer/";
const PREVIEW_URL = "http://127.0.0.1:4174/json-data-drift-analyzer/";

export default defineConfig({
  testDir: "./e2e",
  projects: [
    {
      name: "dev",
      testIgnore: /csp\.spec\.ts/,
      use: { baseURL: DEV_URL }
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
