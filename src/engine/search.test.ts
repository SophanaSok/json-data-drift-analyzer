import { describe, expect, it } from "vitest";
import baseline from "../test/fixtures/baseline.json";
import latest from "../test/fixtures/latest.json";
import { runAnalysis } from "./diff";
import { buildSearchIndex, compareSearchRelevance, loadSearchIndex, searchRecordIds } from "./search";

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

describe("search ranking", () => {
  it("ranks exact record key matches first", () => {
    const analysis = getAnalysis();
    const searchIndex = loadSearchIndex(String(analysis.searchIndexJson));

    expect(searchRecordIds(searchIndex, "91B-2023", analysis.recordsById)[0]).toBe("91B-2023");
  });

  it("ranks record key prefix matches ahead of title matches", () => {
    const analysis = getAnalysis();
    const searchIndex = loadSearchIndex(String(analysis.searchIndexJson));

    expect(searchRecordIds(searchIndex, "91B", analysis.recordsById)[0]).toBe("91B-2023");
  });

  it("ranks title matches by relevance instead of alphabetical record key", () => {
    const analysis = getAnalysis();
    const searchIndex = loadSearchIndex(String(analysis.searchIndexJson));

    expect(searchRecordIds(searchIndex, "Bridge", analysis.recordsById)[0]).toBe("92C-2023");
  });

  it("preserves relevance order when intersecting with filter candidates", () => {
    const analysis = getAnalysis();
    const searchIndex = loadSearchIndex(String(analysis.searchIndexJson));
    const candidates = new Set(["NEW-100", "91B-2023"]);

    expect(searchRecordIds(searchIndex, "NEW", analysis.recordsById, candidates)).toEqual(["NEW-100"]);
  });

  it("serializes and reloads the same ranking behavior", () => {
    const analysis = getAnalysis();
    const builtIndex = buildSearchIndex(analysis.recordsById, analysis.qualityIssues);
    const reloadedIndex = loadSearchIndex(JSON.stringify(builtIndex));

    const builtOrder = searchRecordIds(builtIndex, "Bridge", analysis.recordsById);
    const reloadedOrder = searchRecordIds(reloadedIndex, "Bridge", analysis.recordsById);

    expect(reloadedOrder).toEqual(builtOrder);
    expect(reloadedOrder[0]).toBe("92C-2023");
  });

  it("prefers exact record key matches over higher text scores", () => {
    const analysis = getAnalysis();

    expect(
      compareSearchRelevance("91B-2023", "92C-2023", 1, 10, "91B-2023", analysis.recordsById)
    ).toBeLessThan(0);
  });
});
