import { describe, expect, it } from "vitest";
import { defaultProfile } from "./profile";
import { buildQualityIssues, computeFieldStats } from "./quality";

// The regression these cover: emptyRegressionCount compared baselineRecords[i]
// against latestRecords[i]. The profile's own measurements record that only 4 of
// 499 shared records occupy the same index across runs — with reordered exports
// (the normal case) per-record regression counts were computed between UNRELATED
// records, and that noise fed getSeverityFromPopulationDrop and the quality gate.

function statFor(field: string, stats: ReturnType<typeof computeFieldStats>) {
  const stat = stats.find((item) => item.field === field);
  expect(stat).toBeDefined();
  return stat!;
}

describe("computeFieldStats pairs records by identity, not array index", () => {
  it("counts no regressions when reordered records are individually unchanged", () => {
    const baseline = [
      { ProjectCode: "A", Title: "kept" },
      { ProjectCode: "B", Title: "" }
    ];
    // Same records, reversed order. Index pairing matched A-with-B and counted a
    // phantom regression; identity pairing matches A-with-A and counts none.
    const latest = [
      { ProjectCode: "B", Title: "" },
      { ProjectCode: "A", Title: "kept" }
    ];
    const stats = computeFieldStats(baseline, latest, defaultProfile, ["ProjectCode"]);
    expect(statFor("Title", stats).emptyRegressionCount).toBe(0);
  });

  it("counts a real regression across reordered records", () => {
    const baseline = [
      { ProjectCode: "A", Title: "kept" },
      { ProjectCode: "B", Title: "will be emptied" }
    ];
    const latest = [
      { ProjectCode: "B", Title: "" },
      { ProjectCode: "A", Title: "kept" }
    ];
    const stats = computeFieldStats(baseline, latest, defaultProfile, ["ProjectCode"]);
    expect(statFor("Title", stats).emptyRegressionCount).toBe(1);
  });

  it("counts regressions over matched pairs only — a removed record is not a regression", () => {
    const baseline = [
      { ProjectCode: "A", Title: "kept" },
      { ProjectCode: "GONE", Title: "filled" }
    ];
    const latest = [{ ProjectCode: "A", Title: "kept" }];
    const stats = computeFieldStats(baseline, latest, defaultProfile, ["ProjectCode"]);
    expect(statFor("Title", stats).emptyRegressionCount).toBe(0);
  });

  it("still computes aggregate fill rates over every record, matched or not", () => {
    const baseline = [
      { ProjectCode: "A", Title: "x" },
      { ProjectCode: "GONE", Title: "y" }
    ];
    const latest = [{ ProjectCode: "A", Title: "" }];
    const stats = computeFieldStats(baseline, latest, defaultProfile, ["ProjectCode"]);
    const title = statFor("Title", stats);
    expect(title.baselinePresentCount).toBe(2);
    expect(title.baselinePresentRate).toBe(1);
    expect(title.latestPresentCount).toBe(0);
  });
});

describe("an empty comparison quarantines instead of passing", () => {
  it("raises a critical empty-collection issue when both sides have zero records", () => {
    const issues = buildQualityIssues([], {}, defaultProfile, [], 0, 0);
    const empty = issues.find((issue) => issue.kind === "empty-collection");

    expect(empty).toBeDefined();
    expect(empty!.severity).toBe("critical");
    expect(empty!.description).toContain("collection path");
  });

  it("stays quiet when records exist", () => {
    const issues = buildQualityIssues([], {}, defaultProfile, [], 10, 10);
    expect(issues.find((issue) => issue.kind === "empty-collection")).toBeUndefined();
  });
});
