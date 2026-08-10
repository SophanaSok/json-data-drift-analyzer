import { describe, expect, it, vi } from "vitest";
import {
  DownloadError,
  ERROR_CATEGORIES,
  isRetryable,
  MAX_DOWNLOAD_ATTEMPTS,
  retryOnDownloadTimeout,
  toDownloadError
} from "./errors.ts";

const noSleep = () => Promise.resolve();

describe("isRetryable", () => {
  it("retries a download timeout and nothing else", () => {
    expect(isRetryable("download_timeout")).toBe(true);
    for (const category of ERROR_CATEGORIES.filter((name) => name !== "download_timeout")) {
      expect(isRetryable(category)).toBe(false);
    }
  });
});

describe("toDownloadError", () => {
  it("passes a categorized error through untouched", () => {
    const original = new DownloadError("auth", "rejected");
    expect(toDownloadError(original)).toBe(original);
  });

  it("does not guess a category for an unrecognised failure", () => {
    expect(toDownloadError(new Error("socket hang up")).category).toBe("unknown");
    expect(toDownloadError("string throw").category).toBe("unknown");
  });
});

describe("retryOnDownloadTimeout", () => {
  it("does not retry a call that succeeds", async () => {
    const operation = vi.fn().mockResolvedValue("file.json");
    const result = await retryOnDownloadTimeout(operation, { sleep: noSleep });

    expect(result).toEqual({ value: "file.json", attempts: 1 });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries a download timeout twice, then succeeds", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new DownloadError("download_timeout", "no export"))
      .mockRejectedValueOnce(new DownloadError("download_timeout", "no export"))
      .mockResolvedValue("file.json");

    const result = await retryOnDownloadTimeout(operation, { sleep: noSleep });

    expect(result).toEqual({ value: "file.json", attempts: 3 });
    expect(operation).toHaveBeenCalledTimes(MAX_DOWNLOAD_ATTEMPTS);
  });

  it("gives up after two retries", async () => {
    const operation = vi.fn().mockRejectedValue(new DownloadError("download_timeout", "no export"));

    await expect(retryOnDownloadTimeout(operation, { sleep: noSleep })).rejects.toThrow(DownloadError);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry any other failure", async () => {
    for (const category of ["auth", "run_not_found", "download_failed", "filesystem", "unknown"] as const) {
      const operation = vi.fn().mockRejectedValue(new DownloadError(category, "nope"));
      await expect(retryOnDownloadTimeout(operation, { sleep: noSleep })).rejects.toMatchObject({ category });
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });

  it("announces each retry and waits between attempts", async () => {
    const onRetry = vi.fn();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new DownloadError("download_timeout", "no export"))
      .mockResolvedValue("file.json");

    await retryOnDownloadTimeout(operation, { sleep, onRetry, delayMs: 500 });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toBe(1);
    expect(sleep).toHaveBeenCalledWith(500);
  });
});
