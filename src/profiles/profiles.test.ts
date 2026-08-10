import { describe, expect, it } from "vitest";
import { BELLINGHAM_PROCUREWARE, PROFILES, findProfileContradictions, getProfile } from "./index";
import type { SourceProfile } from "../engine/adapter-types";

describe("profile registry", () => {
  it("exposes the Bellingham profile by id", () => {
    expect(getProfile("bellingham-procureware")).toBe(BELLINGHAM_PROCUREWARE);
    expect(getProfile("nonexistent")).toBeNull();
  });

  it("keys every profile by its own id", () => {
    for (const [key, profile] of Object.entries(PROFILES)) {
      expect(profile.id).toBe(key);
    }
  });

  it("holds no contradictions in any registered profile", () => {
    for (const profile of Object.values(PROFILES)) {
      expect(findProfileContradictions(profile), `${profile.id} should be coherent`).toEqual([]);
    }
  });
});

describe("profile contradiction checks", () => {
  const base: SourceProfile = {
    id: "test",
    version: 1,
    collectionPath: "$",
    primaryKey: ["Id"],
    fallbackKeys: [],
    dedupeKey: ["Id"],
    hardRequiredFields: ["Id"],
    safeBackfillFields: [],
    manualReviewFields: [],
    excludedFields: [],
    minimumMatchRate: 0.5
  };

  it("catches a field that is both auto-backfillable and manual-review-only", () => {
    const problems = findProfileContradictions({
      ...base,
      safeBackfillFields: ["X"],
      manualReviewFields: ["X"]
    });
    expect(problems.join(" ")).toContain("cannot be automatic and human-only");
  });

  it("catches a field that is both backfillable and excluded from comparison", () => {
    const problems = findProfileContradictions({
      ...base,
      safeBackfillFields: ["X"],
      excludedFields: ["X"]
    });
    expect(problems.join(" ")).toContain("never be recovered");
  });

  it("catches an unusable identity or collection configuration", () => {
    expect(findProfileContradictions({ ...base, primaryKey: [] }).join(" ")).toContain("no record can be identified");
    expect(findProfileContradictions({ ...base, collectionPath: "" }).join(" ")).toContain("cannot be located");
  });

  it("catches an out-of-range match rate and a non-positive version", () => {
    expect(findProfileContradictions({ ...base, minimumMatchRate: 1.5 }).join(" ")).toContain("outside 0..1");
    expect(findProfileContradictions({ ...base, version: 0 }).join(" ")).toContain("not a positive integer");
  });

  it("passes a coherent profile", () => {
    expect(findProfileContradictions(base)).toEqual([]);
  });
});

describe("Bellingham profile: the approved policy", () => {
  const profile = BELLINGHAM_PROCUREWARE;

  it("is at v3 with exactly the three approved fields", () => {
    // Deliberately literal: a policy change must fail this test and be re-confirmed
    // by a person, not quietly absorbed by deriving from the profile itself.
    expect(profile.version).toBe(3);
    expect(profile.safeBackfillFields).toEqual(["ContactPhone", "ContactEmail", "BidType"]);
  });

  it("declares the five rule 6 date-sensitive fields", () => {
    expect(profile.dateSensitiveFields).toEqual([
      "DueDate",
      "PublishedDate",
      "AwardDate",
      "BidStatus",
      "ContractValue"
    ]);
  });

  it("approves no rule 6 field", () => {
    // Rule 6 requires a separate, explicit decision per field. None has been made.
    for (const field of profile.dateSensitiveFields ?? []) {
      expect(profile.safeBackfillFields, `${field} must not be backfillable`).not.toContain(field);
    }
  });

  it("keeps the fields with unmeasurable volatility out of automatic backfill", () => {
    for (const field of ["Title", "Description", "BidDocuments"]) {
      expect(profile.safeBackfillFields).not.toContain(field);
    }
  });

  it("identifies records on the GUID-bearing URL, not a human-facing code", () => {
    expect(profile.primaryKey).toEqual(["AgentID", "BidURL"]);
    expect(profile.dedupeKey).toEqual(["AgentID", "BidURL"]);
    expect(profile.fallbackKeys).toEqual([["AgentID", "ProjectCode"]]);
  });

  it("never keys on Title, which collides across recurring solicitations", () => {
    const keyFields = [...profile.primaryKey, ...profile.dedupeKey, ...profile.fallbackKeys.flat()];
    expect(keyFields).not.toContain("Title");
  });

  it("excludes the per-run stamps from drift comparison", () => {
    expect(profile.excludedFields).toEqual(["Created", "Refreshed"]);
  });

  it("carries the approval record in its notes", () => {
    const notes = (profile.notes ?? []).join(" ");
    expect(notes).toContain("PARTIALLY APPROVED at v3");
    expect(notes).toContain("APPROVAL RECORD (v1 -> v2)");
    expect(notes).toContain("APPROVAL RECORD (v2 -> v3)");
    expect(notes).toContain("RULE 6 GUARD");
  });
});
