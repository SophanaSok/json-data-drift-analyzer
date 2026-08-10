/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { readStoredText, writeStoredText } from "./safe-storage";

const KEY = "safe-storage-test-key";

/** Swap window.localStorage for the duration of a test, restoring afterwards. */
function withLocalStorage(replacement: PropertyDescriptor, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, ...replacement });
  try {
    run();
  } finally {
    if (original) {
      Object.defineProperty(window, "localStorage", original);
    } else {
      Reflect.deleteProperty(window as unknown as Record<string, unknown>, "localStorage");
    }
  }
}

describe("safe-storage", () => {
  afterEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      // storage may have been replaced by a throwing stub
    }
  });

  it("round-trips a value", () => {
    expect(writeStoredText(KEY, "hello")).toBe(true);
    expect(readStoredText(KEY)).toBe("hello");
  });

  it("returns null for an unset key", () => {
    expect(readStoredText("never-written")).toBeNull();
  });

  it("survives a localStorage getter that throws (storage denied)", () => {
    withLocalStorage(
      {
        get() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        }
      },
      () => {
        expect(readStoredText(KEY)).toBeNull();
        expect(writeStoredText(KEY, "value")).toBe(false);
      }
    );
  });

  it("survives getItem throwing", () => {
    withLocalStorage(
      {
        value: {
          getItem() {
            throw new DOMException("denied", "SecurityError");
          },
          setItem() {
            /* no-op */
          }
        }
      },
      () => {
        expect(readStoredText(KEY)).toBeNull();
      }
    );
  });

  it("survives setItem throwing (quota exceeded)", () => {
    withLocalStorage(
      {
        value: {
          getItem() {
            return null;
          },
          setItem() {
            throw new DOMException("exceeded the quota", "QuotaExceededError");
          }
        }
      },
      () => {
        expect(writeStoredText(KEY, "value")).toBe(false);
      }
    );
  });

  it("treats a present-but-unusable storage object as absent", () => {
    // Matches the Node >= 22 experimental global: defined, but not a Storage.
    withLocalStorage({ value: {} }, () => {
      expect(readStoredText(KEY)).toBeNull();
      expect(writeStoredText(KEY, "value")).toBe(false);
    });
  });

  it("treats undefined storage as absent", () => {
    withLocalStorage({ value: undefined }, () => {
      expect(readStoredText(KEY)).toBeNull();
      expect(writeStoredText(KEY, "value")).toBe(false);
    });
  });
});
