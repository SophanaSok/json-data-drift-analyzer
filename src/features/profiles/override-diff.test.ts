import { describe, expect, it } from "vitest";
import { diffProfiles } from "./override-diff";
import { mergeProfile, resolveEffectiveProfile } from "../../profiles/resolve";
import type { ProfileOverride, SourceProfileBase } from "../../profiles/schema";

const base: SourceProfileBase = {
  collectionPath: "Export",
  primaryKey: ["AgentID", "BidURL"],
  fallbackKeys: [],
  dedupeKey: ["AgentID", "BidURL"],
  hardRequiredFields: ["AgentID"],
  manualReviewFields: ["DueDate"],
  excludedFields: ["Created", "Refreshed"],
  minimumMatchRate: 0.95,
  quality: {
    requiredFields: ["Title"],
    optionalEmptyFields: [],
    emptyRules: {},
    identityDefault: ["ProjectCode"],
    fieldGroups: [],
    documentFieldPairs: [],
    searchSourceFields: { title: "Title", status: "Status", type: "Type", url: "BidURL" }
  }
};

const repo = mergeProfile(base, {
  id: "test",
  sourceUrl: "https://bids.example.gov",
  version: 3,
  safeBackfillFields: ["ContactEmail"]
});

describe("diffProfiles", () => {
  it("reports no entries for identical profiles", () => {
    expect(diffProfiles(repo, repo)).toEqual([]);
  });

  it("reports list membership changes as added/removed", () => {
    const override: ProfileOverride = {
      profileId: "test",
      revision: 1,
      baseVersion: 3,
      delta: { safeBackfillFields: ["ContactEmail", "BidType"], excludedFields: ["Created"] },
      reason: "r",
      updatedAt: "2026-08-12T00:00:00Z"
    };
    const { profile } = resolveEffectiveProfile(repo, override);
    const entries = diffProfiles(repo, profile);
    expect(entries).toContainEqual({ kind: "list", path: "safeBackfillFields", added: ["BidType"], removed: [] });
    expect(entries).toContainEqual({ kind: "list", path: "excludedFields", added: [], removed: ["Refreshed"] });
  });

  it("reports key and scalar changes as whole values — key order is policy", () => {
    const override: ProfileOverride = {
      profileId: "test",
      revision: 1,
      baseVersion: 3,
      delta: { primaryKey: ["BidURL", "AgentID"], minimumMatchRate: 0.9 },
      reason: "r",
      updatedAt: "2026-08-12T00:00:00Z"
    };
    const { profile } = resolveEffectiveProfile(repo, override);
    const entries = diffProfiles(repo, profile);
    expect(entries).toContainEqual({
      kind: "value",
      path: "primaryKey",
      from: ["AgentID", "BidURL"],
      to: ["BidURL", "AgentID"]
    });
    expect(entries).toContainEqual({ kind: "value", path: "minimumMatchRate", from: 0.95, to: 0.9 });
  });

  it("sees into the quality section", () => {
    const override: ProfileOverride = {
      profileId: "test",
      revision: 1,
      baseVersion: 3,
      delta: { quality: { requiredFields: ["Title", "BidURL"] } },
      reason: "r",
      updatedAt: "2026-08-12T00:00:00Z"
    };
    const { profile } = resolveEffectiveProfile(repo, override);
    expect(diffProfiles(repo, profile)).toContainEqual({
      kind: "list",
      path: "quality.requiredFields",
      added: ["BidURL"],
      removed: []
    });
  });
});
