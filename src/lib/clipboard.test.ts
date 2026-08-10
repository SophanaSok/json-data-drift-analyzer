/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "./clipboard";

function withClipboard(replacement: unknown, run: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { value: replacement, configurable: true });
  return run().finally(() => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "clipboard");
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("copyTextToClipboard", () => {
  it("copies and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await withClipboard({ writeText }, async () => {
      await expect(copyTextToClipboard("hello")).resolves.toBe(true);
      expect(writeText).toHaveBeenCalledWith("hello");
    });
  });

  it("reports failure rather than throwing when the write is rejected", async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    await withClipboard({ writeText }, async () => {
      await expect(copyTextToClipboard("hello")).resolves.toBe(false);
    });
  });

  it("reports failure when the clipboard API is absent", async () => {
    await withClipboard(undefined, async () => {
      await expect(copyTextToClipboard("hello")).resolves.toBe(false);
    });
  });

  it("reports failure when clipboard exists but cannot write", async () => {
    await withClipboard({}, async () => {
      await expect(copyTextToClipboard("hello")).resolves.toBe(false);
    });
  });
});
