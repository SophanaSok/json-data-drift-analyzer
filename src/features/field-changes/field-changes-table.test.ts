import { describe, expect, it } from "vitest";
import baseline from "../../test/fixtures/baseline.json";
import latest from "../../test/fixtures/latest.json";
import { runAnalysis } from "../../engine/diff";
import { sortFieldChangeRows } from "./field-changes-table";

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

describe("field-changes-table sorting", () => {
  const analysis = getAnalysis();

  const rows = analysis.fieldStats.map((stat) => ({
    field: stat.field,
    changedRecords: analysis.indexes.byField[stat.field]?.size ?? 0,
    emptied: 0,
    restored: 0,
    modified: 0,
    baselinePresentRate: stat.baselinePresentRate,
    latestPresentRate: stat.latestPresentRate,
    populationChange: stat.populationChange,
    severity: stat.severity
  }));

  it("sorts by field name ascending", () => {
    const sorted = sortFieldChangeRows(rows, "field", "asc");
    const fields = sorted.map((row) => row.field);
    expect(fields).toEqual([...fields].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  });

  it("sorts by changed records descending", () => {
    const sorted = sortFieldChangeRows(rows, "changedRecords", "desc");
    for (let index = 0; index < sorted.length - 1; index += 1) {
      expect(sorted[index].changedRecords).toBeGreaterThanOrEqual(sorted[index + 1].changedRecords);
    }
  });

  it("sorts by severity ascending", () => {
    const sorted = sortFieldChangeRows(rows, "severity", "asc");
    const severityOrder = ["pass", "info", "warning", "high", "critical"];
    for (let index = 0; index < sorted.length - 1; index += 1) {
      expect(severityOrder.indexOf(sorted[index].severity)).toBeLessThanOrEqual(
        severityOrder.indexOf(sorted[index + 1].severity)
      );
    }
  });
});
