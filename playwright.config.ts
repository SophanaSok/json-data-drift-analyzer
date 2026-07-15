import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:4173/json-data-drift-analyzer/"
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/json-data-drift-analyzer/",
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
});
