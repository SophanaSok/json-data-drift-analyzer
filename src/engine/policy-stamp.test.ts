import { describe, expect, it } from "vitest";
import { runRecoveryReview } from "./review";
import { applyOverridesToRecovery } from "./recovery";
import type { PolicyStamp, SourceProfile } from "./adapter-types";

/**
 * The policy stamp (policyHash + overrideRevision) is what lets provenance
 * distinguish two runs at the same numeric profile version whose resolved
 * policies differ — which becomes possible once a profile is base + delta +
 * optional local override. These tests pin that the stamp flows from the
 * profile into every artifact, and that a stamped mismatch refuses decisions.
 */

const profile: SourceProfile & PolicyStamp = {
  id: "stamp-test",
  version: 2,
  collectionPath: "$",
  primaryKey: ["Id"],
  fallbackKeys: [],
  dedupeKey: ["Id"],
  hardRequiredFields: ["Id"],
  safeBackfillFields: ["Email"],
  manualReviewFields: [],
  excludedFields: [],
  minimumMatchRate: 0.5,
  policyHash: "00000000deadbeef",
  overrideRevision: 3
};

const reference = [{ Id: "r1", Email: "clerk@example.gov", Title: "Road work" }];
const candidate = [{ Id: "r1", Email: "", Title: "Road work" }];

const options = { generatedAt: "2026-08-12T00:00:00.000Z" };

describe("policy stamp propagation", () => {
  const review = runRecoveryReview(reference, candidate, profile, options);

  it("stamps the review", () => {
    expect(review.policyHash).toBe("00000000deadbeef");
    expect(review.overrideRevision).toBe(3);
  });

  it("stamps the recovery result and every provenance entry", () => {
    expect(review.recovery.policyHash).toBe("00000000deadbeef");
    expect(review.recovery.overrideRevision).toBe(3);
    expect(review.recovery.provenance.length).toBeGreaterThan(0);
    for (const entry of review.recovery.provenance) {
      expect(entry.policyHash).toBe("00000000deadbeef");
      expect(entry.overrideRevision).toBe(3);
    }
  });

  it("records null/0 when the profile carries no stamp", () => {
    const { policyHash: _hash, overrideRevision: _revision, ...unstamped } = profile;
    const bare = runRecoveryReview(reference, candidate, unstamped, options);
    expect(bare.policyHash).toBeNull();
    expect(bare.overrideRevision).toBe(0);
    expect(bare.recovery.policyHash).toBeNull();
  });
});

describe("applyOverridesToRecovery under a policy stamp", () => {
  const review = runRecoveryReview(reference, candidate, profile, options);
  const override = {
    recordKey: review.recovery.recovered[0]?.recordKey ?? "Id=r1",
    field: "Title",
    value: "Road work (amended)",
    reason: "Verified against the source page."
  };

  it("applies when the resolved policy matches", () => {
    const application = applyOverridesToRecovery(review.recovery, [override], profile);
    expect(application.appliedCount).toBe(1);
  });

  it("refuses a same-version run whose resolved policy differs", () => {
    const otherPolicy = { ...profile, policyHash: "ffffffffffffffff" };
    expect(() => applyOverridesToRecovery(review.recovery, [override], otherPolicy)).toThrow(
      /Re-run the analysis/
    );
    expect(() => applyOverridesToRecovery(review.recovery, [override], otherPolicy)).toThrow(
      /override revision/
    );
  });

  it("keeps the version check ahead of the hash check", () => {
    const bumped = { ...profile, version: 3 };
    expect(() => applyOverridesToRecovery(review.recovery, [override], bumped)).toThrow(/@3/);
  });

  it("skips the hash check when either side is unstamped", () => {
    const { policyHash: _hash, ...unstampedProfile } = profile;
    const application = applyOverridesToRecovery(review.recovery, [override], unstampedProfile);
    expect(application.appliedCount).toBe(1);
  });
});
