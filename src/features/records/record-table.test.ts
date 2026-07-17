import { describe, expect, it } from "vitest";
import baseline from "../../test/fixtures/baseline.json";
import latest from "../../test/fixtures/latest.json";
import { runAnalysis } from "../../engine/diff";
import type { DiffRecord } from "../../engine/types";
import { getRecordFieldValue, sortRecordIds } from "./record-table";

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

describe("record-table sorting", () => {
  const analysis = getAnalysis();
  const recordsById = analysis.recordsById;
  const ids = analysis.allRecordIds;

  it("reads published and due dates from the active snapshot", () => {
    const changed = recordsById["91B-2023"] as DiffRecord;
    const removed = recordsById["92C-2023"] as DiffRecord;
    expect(getRecordFieldValue(changed, "PublishedDate")).toBe("");
    expect(getRecordFieldValue(changed, "DueDate")).toBe("");
    expect(getRecordFieldValue(removed, "PublishedDate")).toBe("2023-05-01");
    expect(getRecordFieldValue(removed, "DueDate")).toBe("2023-06-15");
  });

  it("sorts by record key ascending by default", () => {
    const sorted = sortRecordIds(ids, recordsById, "recordKey", "asc");
    expect(sorted.map((id) => recordsById[id].recordKey)).toEqual(["91B-2023", "92C-2023", "NEW-100"]);
  });

  it("sorts by due date descending with empty values last", () => {
    const sorted = sortRecordIds(ids, recordsById, "dueDate", "desc");
    expect(sorted.map((id) => getRecordFieldValue(recordsById[id], "DueDate"))).toEqual([
      "2023-09-01",
      "2023-06-15",
      ""
    ]);
  });

  it("sorts by changed field count descending", () => {
    const sorted = sortRecordIds(ids, recordsById, "changedFields", "desc");
    expect(recordsById[sorted[0]].changedFieldCount).toBeGreaterThanOrEqual(recordsById[sorted[1]].changedFieldCount);
  });
});
