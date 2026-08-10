import { describe, expect, it, vi } from "vitest";
import { createLogger, redactSecrets, summarizeDetail } from "./logging.ts";

describe("redactSecrets", () => {
  it("removes every occurrence, not just the first", () => {
    expect(redactSecrets("hunter2 then hunter2", ["hunter2"])).toBe("[redacted] then [redacted]");
  });

  it("removes a secret embedded in a larger string", () => {
    // Playwright quotes URLs back in its errors; a credential in one must not survive.
    expect(redactSecrets("goto https://user:hunter2@dash/login failed", ["hunter2"])).toBe(
      "goto https://user:[redacted]@dash/login failed"
    );
  });

  it("ignores empty secrets rather than shredding the message", () => {
    expect(redactSecrets("nothing secret here", ["", ""])).toBe("nothing secret here");
  });
});

describe("summarizeDetail", () => {
  it("collapses a multi-line report to one line", () => {
    expect(summarizeDetail("Timeout 30000ms exceeded.\n  waiting for locator('#x')\n")).toBe(
      "Timeout 30000ms exceeded. waiting for locator('#x')"
    );
  });

  it("bounds the length", () => {
    const summary = summarizeDetail("x".repeat(1000));
    expect(summary.length).toBe(200);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("leaves a short message intact", () => {
    expect(summarizeDetail("run not listed")).toBe("run not listed");
  });
});

describe("createLogger", () => {
  it("redacts on every channel", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = createLogger(["hunter2", "user@example.com"]);
    logger.info("signing in as user@example.com");
    logger.warn("password hunter2 rejected");
    logger.error("failed for user@example.com with hunter2");

    expect(info).toHaveBeenCalledWith("signing in as [redacted]");
    expect(warn).toHaveBeenCalledWith("password [redacted] rejected");
    expect(error).toHaveBeenCalledWith("failed for [redacted] with [redacted]");

    vi.restoreAllMocks();
  });

  it("can redact without printing, for text headed to the run log", () => {
    const logger = createLogger(["hunter2"]);
    expect(logger.clean("login failed with hunter2")).toBe("login failed with [redacted]");
  });
});
