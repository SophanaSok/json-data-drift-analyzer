import { describe, expect, it } from "vitest";
import baseJson from "./base.json";
import { defaultProfile } from "../engine/profile";
import { validateBase } from "./validate";

/**
 * The base is where 400 sources inherit their defaults from, so its
 * policy-bearing fields are pinned literally: a change here changes every
 * source that does not override the field, and must fail a test and be
 * re-confirmed by a person — the same discipline the per-source pin test
 * applies to the Bellingham delta, applied once instead of 400 times.
 */
describe("base profile: the shared defaults", () => {
  it("validates structurally", () => {
    const result = validateBase(baseJson);
    expect(result.ok, JSON.stringify(!result.ok && result.problems)).toBe(true);
  });

  it("locates records and identity the way every source shares", () => {
    expect(baseJson.collectionPath).toBe("Export");
    expect(baseJson.primaryKey).toEqual(["AgentID", "BidURL"]);
    expect(baseJson.fallbackKeys).toEqual([["AgentID", "ProjectCode"]]);
    expect(baseJson.dedupeKey).toEqual(["AgentID", "BidURL"]);
    expect(baseJson.hardRequiredFields).toEqual(["AgentID", "ProjectCode", "BidURL"]);
  });

  it("declares the five rule 6 date-sensitive fields", () => {
    expect(baseJson.dateSensitiveFields).toEqual([
      "DueDate",
      "PublishedDate",
      "AwardDate",
      "BidStatus",
      "ContractValue"
    ]);
  });

  it("grants no backfill approval — approvals are per-source only", () => {
    // The key must not even exist: validateBase rejects it, and the delta
    // validator requires every source to state its own list explicitly.
    expect("safeBackfillFields" in baseJson).toBe(false);
  });

  it("keeps the shared thresholds and exclusions", () => {
    expect(baseJson.minimumMatchRate).toBe(0.95);
    expect(baseJson.excludedFields).toEqual(["Created", "Refreshed"]);
    expect(baseJson.manualReviewFields).toEqual([
      "BidStatus",
      "PublishedDate",
      "DueDate",
      "AwardDate",
      "Description",
      "BidDocuments",
      "BidDocumentHashes",
      "ContractValue"
    ]);
  });

  it("pins the quality field groups and their severities", () => {
    expect(baseJson.quality.fieldGroups.map((g) => [g.id, g.severity, g.thresholdDrop, g.minAffectedFields])).toEqual([
      ["header-metadata", "critical", 0.5, 3],
      ["identity-routing", "high", 0.3, 2],
      ["document-extraction", "high", 0.3, 2]
    ]);
    expect(baseJson.quality.requiredFields).toEqual(["ProjectCode", "Title", "BidURL"]);
  });
});

describe("the deprecated engine defaultProfile", () => {
  it("matches the base quality section exactly, so the two cannot drift", () => {
    const { id: _id, version: _version, name: _name, ...qualityFields } = defaultProfile;
    expect(qualityFields).toEqual(baseJson.quality);
  });
});
