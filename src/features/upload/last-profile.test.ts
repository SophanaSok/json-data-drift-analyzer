import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLastProfileId, saveLastProfileId } from "./last-profile";

/** Minimal localStorage stand-in; the node test environment has none. */
function installStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => backing.set(key, value)
    }
  });
  return backing;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("last-used profile persistence", () => {
  it("round-trips an id", () => {
    installStorage();
    expect(loadLastProfileId()).toBeNull();
    saveLastProfileId("everett-bids");
    expect(loadLastProfileId()).toBe("everett-bids");
  });

  it("treats an empty stored value as unset", () => {
    const backing = installStorage();
    backing.set("last-source-profile-id", "");
    expect(loadLastProfileId()).toBeNull();
  });

  it("degrades to null without storage", () => {
    expect(loadLastProfileId()).toBeNull();
    // And saving is a silent no-op rather than a throw.
    expect(() => saveLastProfileId("x")).not.toThrow();
  });
});
