import { describe, expect, it } from "vitest";
import {
  buildSummaryTiles,
  changedRecords,
  groupBackfillsByField,
  groupExclusions,
  provenanceRowsForRecord,
  withheldFields
} from "./recovery-review-table";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import type { SourceProfile } from "../../engine/adapter-types";
import referenceData from "../../test/fixtures/bellingham-reference.json";
import candidateData from "../../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const FIXED_NOW = "2026-08-10T00:00:00.000Z";

const review = runRecoveryReview(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE, {
  generatedAt: FIXED_NOW,
  sourceRun: "candidate.json",
  referenceRun: "reference.json"
});

describe("recovery review: proposed changes by field", () => {
  const groups = groupBackfillsByField(review);

  it("groups every backfill by field", () => {
    expect(groups.map((group) => group.field).sort()).toEqual([
      "BidType",
      "ContactEmail",
      "ContactPhone",
      "Title"
    ]);
  });

  it("counts match the engine, never a recount", () => {
    const total = groups.reduce((sum, group) => sum + group.count, 0);
    expect(total).toBe(review.recovery.summary.backfilledFieldCount);
  });

  it("orders by volume so the largest change reads first", () => {
    expect(groups[0].field).toBe("Title");
    expect(groups[0].count).toBe(499);
    expect(groups.map((group) => group.count)).toEqual([499, 495, 242, 171]);
  });

  it("reports distinct values and caps the sample without hiding the total", () => {
    const contactEmail = groups.find((group) => group.field === "ContactEmail");

    expect(contactEmail?.count).toBe(242);
    // 3 case variants of bids@cob.org plus purchasing@cob.org appear in the reference.
    expect(contactEmail?.distinctValueCount).toBeGreaterThan(1);
    expect(contactEmail?.sampleValues.length).toBeLessThanOrEqual(5);
    expect(contactEmail?.sampleValues.length).toBeLessThanOrEqual(contactEmail!.distinctValueCount);
  });

  it("carries examples a reviewer can trace back to a record", () => {
    for (const group of groups) {
      expect(group.examples.length).toBeGreaterThan(0);
      expect(group.examples.length).toBeLessThanOrEqual(3);
      for (const example of group.examples) {
        expect(example.recordKey).toBeTruthy();
        expect(example.candidateIndex).not.toBeNull();
      }
    }
  });

  it("lists nothing when the profile approves nothing", () => {
    const unapproved: SourceProfile = { ...BELLINGHAM_PROCUREWARE, safeBackfillFields: [] };
    const empty = runRecoveryReview(referenceRecords, candidateRecords, unapproved, { generatedAt: FIXED_NOW });
    expect(groupBackfillsByField(empty)).toEqual([]);
  });
});

describe("recovery review: withheld fields", () => {
  it("names the rule 6 fields the policy withheld", () => {
    expect(withheldFields(review)).toEqual([
      "AwardDate",
      "BidStatus",
      "ContractValue",
      "DueDate",
      "PublishedDate"
    ]);
  });
});

describe("recovery review: summary tiles", () => {
  const tiles = buildSummaryTiles(review);

  it("reports the match rate against the profile minimum", () => {
    const tile = tiles.find((item) => item.id === "match-rate");
    expect(tile?.value).toBe("99.80%");
    expect(tile?.tone).toBe("good");
  });

  it("reports recovered values from the engine summary", () => {
    const tile = tiles.find((item) => item.id === "values-recovered");
    expect(tile?.value).toBe(String(review.recovery.summary.backfilledFieldCount));
  });

  it("marks a below-minimum match rate as bad", () => {
    const strict: SourceProfile = { ...BELLINGHAM_PROCUREWARE, minimumMatchRate: 0.999 };
    const strictReview = runRecoveryReview(referenceRecords, candidateRecords, strict, { generatedAt: FIXED_NOW });
    expect(buildSummaryTiles(strictReview).find((item) => item.id === "match-rate")?.tone).toBe("bad");
  });

  it("says so plainly when no field is approved", () => {
    const unapproved: SourceProfile = { ...BELLINGHAM_PROCUREWARE, safeBackfillFields: [] };
    const empty = runRecoveryReview(referenceRecords, candidateRecords, unapproved, { generatedAt: FIXED_NOW });
    const tile = buildSummaryTiles(empty).find((item) => item.id === "values-recovered");

    expect(tile?.value).toBe("0");
    expect(tile?.detail).toContain("no field is approved");
  });
});

describe("recovery review: exclusions", () => {
  it("reports none for the clean Bellingham run", () => {
    expect(groupExclusions(review)).toEqual([]);
  });

  it("groups by reason and keeps the detail text", () => {
    const strict: SourceProfile = {
      ...BELLINGHAM_PROCUREWARE,
      hardRequiredFields: ["AgentID", "ProjectCode", "BidURL", "Title"],
      safeBackfillFields: []
    };
    const strictReview = runRecoveryReview(referenceRecords, candidateRecords, strict, { generatedAt: FIXED_NOW });
    const groups = groupExclusions(strictReview);

    expect(groups[0].reason).toBe("hard_required_field_missing");
    expect(groups[0].count).toBeGreaterThan(0);
    expect(groups[0].examples[0].detail).toContain("Title");
  });
});

describe("recovery review: record drill-down", () => {
  const records = changedRecords(review);

  it("lists every record that would change", () => {
    expect(records.length).toBe(review.recovery.summary.recordsWithBackfill);
  });

  it("orders by how much would change", () => {
    for (let index = 1; index < records.length; index += 1) {
      expect(records[index - 1].changedFieldCount).toBeGreaterThanOrEqual(records[index].changedFieldCount);
    }
  });

  it("returns provenance rows for a record, sorted by field", () => {
    const rows = provenanceRowsForRecord(review, records[0].recordKey);
    const fields = rows.map((row) => row.field);

    expect(rows.length).toBe(records[0].changedFieldCount);
    expect(fields).toEqual([...fields].sort());
    for (const row of rows) {
      expect(row.source).toBe("reference_backfill");
      expect(row.originalValue).toBe("");
      expect(row.outputValue).not.toBe("");
      expect(row.reason).toBeTruthy();
    }
  });

  it("returns nothing for a record with no provenance", () => {
    expect(provenanceRowsForRecord(review, "no-such-record")).toEqual([]);
  });
});
