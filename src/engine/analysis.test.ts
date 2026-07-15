import { describe, expect, it } from "vitest";
import baseline from "../test/fixtures/baseline.json";
import latest from "../test/fixtures/latest.json";
import { runAnalysis } from "./diff";
import { intersectSets } from "../lib/sets";

function getAnalysis() {
  return runAnalysis({
    baselineData: baseline,
    latestData: latest,
    baselineFileName: "baseline.json",
    latestFileName: "latest.json",
    analysisKey: "fixture-key",
    config: {
      collectionPath: "Export",
      identityFields: ["ProjectCode"],
      ignoredFields: [],
      profileId: "default-government-bids"
    }
  });
}

describe("analysis engine", () => {
  it("matches by ProjectCode and classifies record statuses", () => {
    const result = getAnalysis();
    expect(result.summary.addedCount).toBe(1);
    expect(result.summary.removedCount).toBe(1);
    expect(result.summary.changedCount).toBe(1);
  });

  it("classifies emptied and restored changes", () => {
    const result = getAnalysis();
    const changed = result.recordsById["91B-2023"];
    const titleChange = changed.changedFields.find((change) => change.path === "Title");
    expect(titleChange?.kind).toBe("emptied");
  });

  it("detects document modifications and incomplete docs", () => {
    const result = getAnalysis();
    const changed = result.recordsById["91B-2023"];
    const diff = changed.documentDiffs.BidDocuments;
    expect(diff.modifiedCount).toBeGreaterThan(0);
    expect(diff.incompleteCount).toBeGreaterThan(0);
  });

  it("detects header metadata incident and critical quality", () => {
    const result = getAnalysis();
    expect(result.qualityIssues.some((issue) => issue.id === "group-header-metadata")).toBe(true);
    expect(result.narrative).toContain("Bid header metadata");
  });

  it("builds set-based filter indexes", () => {
    const result = getAnalysis();
    const ids = intersectSets([result.indexes.byStatus.changed, result.indexes.byChangeKind.emptied]);
    expect(ids.has("91B-2023")).toBe(true);
  });

  it("produces stable analysis cache key usage", () => {
    const resultA = getAnalysis();
    const resultB = getAnalysis();
    expect(resultA.analysisKey).toBe(resultB.analysisKey);
  });

  it("treats document reordering as unchanged", () => {
    const reorderBaseline = { Export: [{ ProjectCode: "R1", BidDocuments: [{ Title: "A", URL: "u1", Hash: "h1" }, { Title: "B", URL: "u2", Hash: "h2" }], BidDocumentHashes: ["h1", "h2"] }] };
    const reorderLatest = { Export: [{ ProjectCode: "R1", BidDocuments: [{ Title: "B", URL: "u2", Hash: "h2" }, { Title: "A", URL: "u1", Hash: "h1" }], BidDocumentHashes: ["h1", "h2"] }] };
    const result = runAnalysis({ baselineData: reorderBaseline, latestData: reorderLatest, baselineFileName: "b", latestFileName: "l", analysisKey: "r", config: { collectionPath: "Export", identityFields: ["ProjectCode"], ignoredFields: [], profileId: "default-government-bids" } });
    expect(result.recordsById.R1.documentDiffs.BidDocuments.modifiedCount).toBe(0);
  });
});
