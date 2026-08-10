import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // .tsx too, or component tests silently never run.
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"]
    }
  }
});
