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
      // Set just below measured coverage (91.4 / 83.0 / 88.5 / 92.9 after the
      // Phase 4 merges) so regressions fail CI without making every small
      // refactor fight the gate.
      thresholds: {
        statements: 90,
        branches: 81,
        functions: 87,
        lines: 91
      }
    }
  }
});
