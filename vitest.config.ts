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
      // The whole source tree: with `include` set, vitest 4 counts matching
      // files whether or not any test imports them (`all` is gone in v4).
      // Without this the denominator shifts every time a test pulls in a new
      // import graph, and the thresholds break on unrelated changes — which
      // has already blocked a deploy once.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "src/**/*.test.{ts,tsx}", "src/main.tsx", "src/vite-env.d.ts"],
      // Set just below coverage as measured against that full denominator so
      // regressions fail CI without making every small refactor fight the gate.
      thresholds: {
        statements: 76,
        branches: 70,
        functions: 70,
        lines: 78
      }
    }
  }
});
