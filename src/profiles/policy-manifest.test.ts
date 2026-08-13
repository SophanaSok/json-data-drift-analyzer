import { describe, expect, it } from "vitest";
import manifest from "./policy-manifest.json";
import { PROFILES } from "./index";
import { canonicalProfileJson, hashPolicy } from "./resolve";

/**
 * The policy-change gate. The manifest pins every profile's (version,
 * policyHash); this test recomputes both from the committed files. Any policy
 * edit therefore fails here until `npm run profiles:manifest` is run
 * deliberately — and that tool refuses a content change without a version
 * bump. Together they preserve, fleet-wide, the discipline the per-source pin
 * test provides for Bellingham: a policy change must fail a test and be
 * re-confirmed by a person, never absorbed silently.
 */
describe("policy manifest", () => {
  const recomputed = Object.fromEntries(
    Object.values(PROFILES).map((profile) => [
      profile.id,
      { version: profile.version, policyHash: hashPolicy(canonicalProfileJson(profile)) }
    ])
  );

  it("matches the committed profiles exactly", () => {
    expect(
      manifest,
      "Profile policy changed without regenerating the manifest. Review the diff, then run: npm run profiles:manifest"
    ).toEqual(recomputed);
  });

  it("covers every registered profile and nothing else", () => {
    expect(Object.keys(manifest).sort()).toEqual(Object.keys(PROFILES).sort());
  });
});
