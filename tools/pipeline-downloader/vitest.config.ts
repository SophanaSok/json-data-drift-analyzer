import { defineConfig } from "vitest/config";

/**
 * This package keeps its own Vitest config so the tool's tests stay out of the app's
 * `npm test` run and never load the app's jsdom setup file. Only the pure layer
 * (arguments, filenames, run log, redaction, retry policy) is covered here; the
 * Playwright flow in `src/browser.ts` needs a real dashboard and is exercised by hand.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
