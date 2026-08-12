import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // .tsx too, or component tests silently never run.
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Set just below measured coverage at the time gating was added
      // (92.7 / 84.0 / 91.8 / 93.9) so regressions fail CI without making
      // every small refactor fight the gate.
      thresholds: {
        statements: 90,
        branches: 82,
        functions: 89,
        lines: 91
      }
    }
  }
});
