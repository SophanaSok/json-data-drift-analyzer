import { describe, expect, it } from "vitest";
import { baselineSnapshot, runAnalysis } from "./diff";
import { buildRecordKey } from "./identity";
import referenceRaw from "../test/fixtures/bellingham-reference.json?raw";
import candidateRaw from "../test/fixtures/bellingham-candidate.json?raw";
import { parseJSON } from "./source-loader";

/**
 * The drift engine against the REAL Bellingham pair.
 *
 * Two things are pinned here: that the result graph stays close to the size of its
 * inputs (it is structured-cloned to the main thread and written to IndexedDB in one
 * piece), and that slimming the graph lost no information — every changed record's
 * baseline body must reconstruct exactly from the latest body plus the recorded
 * changes, for all 499 real changed records.
 */
const referenceLoad = parseJSON(referenceRaw, "bellingham-reference.json");
const candidateLoad = parseJSON(candidateRaw, "bellingham-candidate.json");
const referenceRecords = (referenceLoad.dataset as { Export: Array<Record<string, unknown>> }).Export;

const analysis = runAnalysis({
  baselineData: referenceLoad.dataset,
  latestData: candidateLoad.dataset,
  baselineFileName: "bellingham-reference.json",
  latestFileName: "bellingham-candidate.json",
  analysisKey: "bellingham-scale",
  config: {
    collectionPath: "Export",
    identityFields: ["ProjectCode"],
    ignoredFields: [],
    profileId: "default-government-bids"
  }
});

describe("drift analysis on the real Bellingham pair", () => {
  it("classifies the documented churn: 499 changed, 1 added, 1 removed", () => {
    expect(analysis.summary.changedCount).toBe(499);
    expect(analysis.summary.addedCount).toBe(1);
    expect(analysis.summary.removedCount).toBe(1);
    expect(analysis.summary.unchangedCount).toBe(0);
  });

  it("quarantines the run — the eight-field wipe is a critical incident", () => {
    expect(analysis.summary.qualityGate).toBe("Quarantined");
    expect(analysis.qualityIssues.some((issue) => issue.id === "group-header-metadata")).toBe(true);
  });

  it("document diffing is live on the real export shape (JSON-encoded lists)", () => {
    // The regression: list-valued fields in the real export are JSON-encoded
    // STRINGS ("[]", "[{…}]"), and normalizeDocuments only accepted real arrays —
    // so every document diff on this exact data was silently all-zeros. 350 of the
    // 500 reference records carry at least one bid document.
    const totalBaselineDocs = Object.values(analysis.recordsById).reduce(
      (sum, record) => sum + (record.documentDiffs.BidDocuments?.baselineCount ?? 0),
      0
    );
    expect(totalBaselineDocs).toBeGreaterThanOrEqual(350);
  });

  it("reconstructs the exact baseline body for every changed record", () => {
    const baselineByKey = new Map(
      // recordKey is the display label; the collision-proof key is the record id.
      referenceRecords.map((record) => [buildRecordKey(record, ["ProjectCode"]).label, record])
    );

    let checked = 0;
    for (const record of Object.values(analysis.recordsById)) {
      if (record.status !== "changed") continue;
      expect(record.baseline).toBeUndefined();
      expect(baselineSnapshot(record)).toEqual(baselineByKey.get(record.recordKey));
      checked += 1;
    }
    expect(checked).toBe(499);
  });

  it("keeps the serialized result graph no larger than its inputs, with margin", () => {
    // Before the slimming this graph was ~1.5x the combined input bytes (both full
    // record bodies embedded per DiffRecord); it now measures ~0.98x. The 1.25x
    // ceiling leaves headroom for legitimate metadata growth while making the next
    // "embed a full copy per record" regression fail loudly.
    const inputBytes = referenceRaw.length + candidateRaw.length;
    const resultBytes = JSON.stringify(analysis).length;
    expect(resultBytes).toBeLessThan(inputBytes * 1.25);
  });
});
