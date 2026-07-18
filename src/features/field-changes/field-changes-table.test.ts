import { describe, expect, it } from "vitest";
import baseline from "../../test/fixtures/baseline.json";
import latest from "../../test/fixtures/latest.json";
import { runAnalysis } from "../../engine/diff";
import {
  describePopulationChange,
  formatPopulationChange,
  POPULATION_CHANGE_EXPLANATION,
  sortFieldChangeRows,
  type FieldChangeRow
} from "./field-changes-table";

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

describe("field population change labels", () => {
  const row: FieldChangeRow = {
    field: "status",
    changedRecords: 65,
    emptied: 65,
    restored: 0,
    modified: 0,
    baselinePresentRate: 0.95,
    latestPresentRate: 0.3,
    populationChange: -0.65,
    severity: "high"
  };

  it("keeps the compact analyst-facing pp notation", () => {
    expect(formatPopulationChange(row.populationChange)).toBe("-65.0pp");
  });

  it("describes the baseline-to-latest movement in full", () => {
    expect(describePopulationChange(row)).toBe(
      "Field fill rate: 95.0% → 30.0% (-65.0 percentage points)"
    );
  });

  it("defines pp with its calculation and an example", () => {
    expect(POPULATION_CHANGE_EXPLANATION).toContain("Latest − Baseline");
    expect(POPULATION_CHANGE_EXPLANATION).toContain("95% → 30% = −65pp");
  });
});
