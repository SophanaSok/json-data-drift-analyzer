import { describe, expect, it } from "vitest";
import {
  PROFILES,
  PROFILE_DIAGNOSTICS,
  findProfileContradictions,
  findRegisteredProfileContradictions
} from "./index";
import { validateDelta } from "./validate";

/**
 * Invariants every registered source must satisfy, however many there are.
 * Per-source policy pins don't scale past a handful of sources; what scales is
 * validating the whole fleet structurally and pinning only the base
 * (base.test.ts) plus the policy manifest (policy-manifest.test.ts).
 */

const deltaFiles = import.meta.glob("./sources/*.json", { eager: true, import: "default" });

describe("every committed profile delta", () => {
  it("exists — the registry must never be empty", () => {
    expect(Object.keys(deltaFiles).length).toBeGreaterThan(0);
  });

  it("validates structurally", () => {
    for (const [file, json] of Object.entries(deltaFiles)) {
      const result = validateDelta(json);
      expect(result.ok, `${file}: ${JSON.stringify(!result.ok && result.problems)}`).toBe(true);
    }
  });

  it("is named after its id", () => {
    for (const [file, json] of Object.entries(deltaFiles)) {
      const stem = file.replace(/^\.\/sources\//, "").replace(/\.json$/, "");
      expect((json as { id: string }).id, file).toBe(stem);
    }
  });

  it("states its own safeBackfillFields key literally in the file", () => {
    // Belt and braces over validateDelta: the approval statement must be IN
    // the delta, not inherited, defaulted, or injected (AGENTS.md rules 4/6).
    for (const [file, json] of Object.entries(deltaFiles)) {
      expect(Object.prototype.hasOwnProperty.call(json, "safeBackfillFields"), file).toBe(true);
    }
  });
});

describe("the registry", () => {
  it("registered every committed file — diagnostics must be empty in a healthy tree", () => {
    expect(PROFILE_DIAGNOSTICS).toEqual([]);
    expect(Object.keys(PROFILES).length).toBe(Object.keys(deltaFiles).length);
  });

  it("keys every profile by its own id", () => {
    for (const [key, profile] of Object.entries(PROFILES)) {
      expect(profile.id).toBe(key);
    }
  });

  it("holds unique source URLs", () => {
    const urls = Object.values(PROFILES).map((p) => p.sourceUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("holds no contradictions in any merged profile", () => {
    for (const profile of Object.values(PROFILES)) {
      expect(findProfileContradictions(profile), profile.id).toEqual([]);
      expect(findRegisteredProfileContradictions(profile), profile.id).toEqual([]);
    }
  });

  it("gives every profile a resolvable quality section", () => {
    for (const profile of Object.values(PROFILES)) {
      expect(profile.quality.requiredFields.length, profile.id).toBeGreaterThan(0);
      expect(profile.quality.searchSourceFields.url.length, profile.id).toBeGreaterThan(0);
    }
  });
});
