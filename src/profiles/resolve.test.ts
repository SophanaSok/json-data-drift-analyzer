import { describe, expect, it } from "vitest";
import type { ProfileOverride, SourceProfileBase, SourceProfileDelta } from "./schema";
import {
  canonicalProfileJson,
  hashPolicy,
  mergeProfile,
  resolveEffectiveProfile,
  toQualityProfile
} from "./resolve";

const base: SourceProfileBase = {
  collectionPath: "Export",
  primaryKey: ["AgentID", "BidURL"],
  fallbackKeys: [["AgentID", "ProjectCode"]],
  dedupeKey: ["AgentID", "BidURL"],
  hardRequiredFields: ["AgentID", "ProjectCode", "BidURL"],
  manualReviewFields: ["BidStatus", "DueDate"],
  excludedFields: ["Created", "Refreshed"],
  minimumMatchRate: 0.95,
  dateSensitiveFields: ["DueDate", "PublishedDate"],
  quality: {
    requiredFields: ["ProjectCode", "Title", "BidURL"],
    optionalEmptyFields: ["AwardDate"],
    emptyRules: { BidDocuments: { allowEmptyArray: true } },
    identityDefault: ["ProjectCode"],
    fieldGroups: [
      {
        id: "header-metadata",
        name: "Bid header metadata",
        fields: ["Title", "BidStatus"],
        thresholdDrop: 0.5,
        minAffectedFields: 2,
        severity: "critical",
        narrative: "Header extraction failure."
      }
    ],
    documentFieldPairs: [{ docs: "BidDocuments", hashes: "BidDocumentHashes" }],
    searchSourceFields: { title: "Title", status: "BidStatus", type: "BidType", url: "BidURL" }
  }
};

const delta: SourceProfileDelta = {
  id: "test-source",
  sourceUrl: "https://bids.example.gov",
  version: 3,
  safeBackfillFields: ["ContactEmail"],
  notes: ["APPROVAL: ContactEmail approved."]
};

describe("mergeProfile", () => {
  it("inherits every base value the delta does not mention", () => {
    const merged = mergeProfile(base, delta);
    expect(merged.collectionPath).toBe("Export");
    expect(merged.primaryKey).toEqual(["AgentID", "BidURL"]);
    expect(merged.minimumMatchRate).toBe(0.95);
    expect(merged.quality).toEqual(base.quality);
  });

  it("takes identity and approvals only from the delta", () => {
    const merged = mergeProfile(base, delta);
    expect(merged.id).toBe("test-source");
    expect(merged.sourceUrl).toBe("https://bids.example.gov");
    expect(merged.version).toBe(3);
    expect(merged.safeBackfillFields).toEqual(["ContactEmail"]);
    expect(merged.notes).toEqual(["APPROVAL: ContactEmail approved."]);
  });

  it("replaces a base array wholesale, allowing a delta to empty it", () => {
    const merged = mergeProfile(base, { ...delta, excludedFields: [] });
    expect(merged.excludedFields).toEqual([]);
  });

  it("replaces, never unions, a list the delta restates", () => {
    const merged = mergeProfile(base, { ...delta, manualReviewFields: ["ContractValue"] });
    expect(merged.manualReviewFields).toEqual(["ContractValue"]);
  });

  it("merges the quality section per sub-key, inheriting the rest", () => {
    const merged = mergeProfile(base, {
      ...delta,
      quality: { requiredFields: ["Id", "Url"] }
    });
    expect(merged.quality.requiredFields).toEqual(["Id", "Url"]);
    expect(merged.quality.searchSourceFields).toEqual(base.quality.searchSourceFields);
    expect(merged.quality.fieldGroups).toEqual(base.quality.fieldGroups);
  });

  it("does not let an explicit undefined clobber a base value", () => {
    const merged = mergeProfile(base, { ...delta, minimumMatchRate: undefined });
    expect(merged.minimumMatchRate).toBe(0.95);
  });
});

describe("resolveEffectiveProfile", () => {
  const repoProfile = mergeProfile(base, delta);

  const override: ProfileOverride = {
    profileId: "test-source",
    revision: 2,
    baseVersion: 3,
    delta: { minimumMatchRate: 0.9, quality: { requiredFields: ["ProjectCode"] } },
    reason: "Source dropped Title from its exports; verified 2026-08-12.",
    updatedAt: "2026-08-12T00:00:00Z"
  };

  it("without an override, stamps revision 0 and a content hash", () => {
    const { profile, overrideApplied, overrideStale } = resolveEffectiveProfile(repoProfile, null);
    expect(overrideApplied).toBe(false);
    expect(overrideStale).toBe(false);
    expect(profile.overrideRevision).toBe(0);
    expect(profile.policyHash).toMatch(/^[0-9a-f]{16}$/);
    expect(profile.minimumMatchRate).toBe(0.95);
  });

  it("applies a current override with the same replace semantics", () => {
    const { profile, overrideApplied } = resolveEffectiveProfile(repoProfile, override);
    expect(overrideApplied).toBe(true);
    expect(profile.overrideRevision).toBe(2);
    expect(profile.minimumMatchRate).toBe(0.9);
    expect(profile.quality.requiredFields).toEqual(["ProjectCode"]);
    expect(profile.quality.searchSourceFields).toEqual(base.quality.searchSourceFields);
    // Identity is not overridable.
    expect(profile.id).toBe("test-source");
    expect(profile.version).toBe(3);
  });

  it("refuses a stale override written against an older repo version", () => {
    const stale = { ...override, baseVersion: 2 };
    const { profile, overrideApplied, overrideStale } = resolveEffectiveProfile(repoProfile, stale);
    expect(overrideApplied).toBe(false);
    expect(overrideStale).toBe(true);
    expect(profile.overrideRevision).toBe(0);
    expect(profile.minimumMatchRate).toBe(0.95);
    expect(profile.policyHash).toBe(resolveEffectiveProfile(repoProfile, null).profile.policyHash);
  });

  it("changes the policy hash when and only when resolved content changes", () => {
    const plain = resolveEffectiveProfile(repoProfile, null).profile.policyHash;
    const overridden = resolveEffectiveProfile(repoProfile, override).profile.policyHash;
    expect(overridden).not.toBe(plain);

    // An override that restates current values verbatim is content-identical.
    const noop: ProfileOverride = { ...override, delta: { minimumMatchRate: 0.95 } };
    expect(resolveEffectiveProfile(repoProfile, noop).profile.policyHash).toBe(plain);
  });
});

describe("canonical serialization and hashing", () => {
  const repoProfile = mergeProfile(base, delta);

  it("is independent of key order", () => {
    // Equal content, reversed key insertion order at both nesting levels.
    const reordered = {
      ...Object.fromEntries(Object.entries(repoProfile).reverse()),
      quality: Object.fromEntries(Object.entries(repoProfile.quality).reverse())
    } as typeof repoProfile;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(repoProfile));
    expect(canonicalProfileJson(reordered)).toBe(canonicalProfileJson(repoProfile));
  });

  it("preserves array order, which is policy-bearing for composite keys", () => {
    const swapped = { ...repoProfile, primaryKey: ["BidURL", "AgentID"] };
    expect(canonicalProfileJson(swapped)).not.toBe(canonicalProfileJson(repoProfile));
  });

  it("hashes stably", () => {
    expect(hashPolicy("")).toBe("cbf29ce484222325");
    expect(hashPolicy("a")).not.toBe(hashPolicy("b"));
    expect(hashPolicy(canonicalProfileJson(repoProfile))).toBe(hashPolicy(canonicalProfileJson(repoProfile)));
  });
});

describe("toQualityProfile", () => {
  it("derives the engine view from the resolved profile", () => {
    const { profile } = resolveEffectiveProfile(mergeProfile(base, delta), null);
    const quality = toQualityProfile(profile);
    expect(quality.id).toBe("test-source");
    expect(quality.version).toBe(3);
    expect(quality.name).toBe("test-source");
    expect(quality.requiredFields).toEqual(base.quality.requiredFields);
    expect(quality.searchSourceFields).toEqual(base.quality.searchSourceFields);
  });

  it("prefers the display name when present", () => {
    const { profile } = resolveEffectiveProfile(
      mergeProfile(base, { ...delta, displayName: "Example County Bids" }),
      null
    );
    expect(toQualityProfile(profile).name).toBe("Example County Bids");
  });
});
