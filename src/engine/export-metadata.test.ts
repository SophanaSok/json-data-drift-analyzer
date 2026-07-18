import { describe, expect, it } from "vitest";
import {
  extractExportDates,
  findDateOrderingIssues,
  formatExportDates,
  getAnalysisDateOrderingIssues,
  hasDateOrderingIssue
} from "./export-metadata";

describe("export metadata", () => {
  it("extracts Refreshed and Created from root export JSON", () => {
    const dates = extractExportDates({
      Refreshed: "2024-02-01T10:00:00Z",
      Created: "2024-01-01T08:00:00Z",
      Export: []
    });

    expect(dates).toEqual({
      Refreshed: "2024-02-01T10:00:00Z",
      Created: "2024-01-01T08:00:00Z"
    });
  });

  it("ignores empty or missing export date fields", () => {
    expect(extractExportDates({ Refreshed: "  ", Export: [] })).toEqual({});
    expect(extractExportDates(null)).toEqual({});
  });

  it("flags baseline dates that are newer than or equal to latest dates", () => {
    const issues = findDateOrderingIssues(
      { Refreshed: "2024-03-01", Created: "2024-01-15" },
      { Refreshed: "2024-02-01", Created: "2024-01-20" }
    );

    expect(issues).toEqual([
      { field: "Refreshed", baseline: "2024-03-01", latest: "2024-02-01" }
    ]);
  });

  it("flags equal baseline and latest dates", () => {
    const issues = findDateOrderingIssues(
      { Created: "2024-01-01" },
      { Created: "2024-01-01" }
    );

    expect(issues).toEqual([
      { field: "Created", baseline: "2024-01-01", latest: "2024-01-01" }
    ]);
  });

  it("does not flag correctly ordered baseline dates", () => {
    const issues = findDateOrderingIssues(
      { Refreshed: "2024-01-01", Created: "2023-12-01" },
      { Refreshed: "2024-02-01", Created: "2024-01-01" }
    );

    expect(issues).toEqual([]);
  });

  it("formats export dates for display", () => {
    expect(formatExportDates({ Refreshed: "2024-01-01" })).toBe("Refreshed: 2024-01-01");
    expect(formatExportDates({})).toBe("No export dates found");
  });

  it("detects date ordering issues for toast notifications", () => {
    expect(hasDateOrderingIssue([{ field: "Created", baseline: "2024-02-01", latest: "2024-01-01" }])).toBe(true);
    expect(hasDateOrderingIssue([{ field: "Refreshed", baseline: "2024-03-01", latest: "2024-02-01" }])).toBe(true);
    expect(hasDateOrderingIssue([])).toBe(false);
  });

  it("reads date ordering issues from analysis metadata", () => {
    const issues = [{ field: "Refreshed" as const, baseline: "2024-03-01", latest: "2024-02-01" }];
    expect(
      getAnalysisDateOrderingIssues({
        baselineFileName: "baseline.json",
        latestFileName: "latest.json",
        collectionPath: "Export",
        identityFields: ["ProjectCode"],
        ignoredFields: [],
        generatedAt: "2024-01-01T00:00:00Z",
        baselineExportDates: { Refreshed: "2024-03-01" },
        latestExportDates: { Refreshed: "2024-02-01" },
        dateOrderingIssues: issues
      })
    ).toEqual(issues);
  });

  it("derives date ordering issues from export dates when metadata issues are missing", () => {
    expect(
      getAnalysisDateOrderingIssues({
        baselineFileName: "baseline.json",
        latestFileName: "latest.json",
        collectionPath: "Export",
        identityFields: ["ProjectCode"],
        ignoredFields: [],
        generatedAt: "2024-01-01T00:00:00Z",
        baselineExportDates: { Created: "2024-03-01" },
        latestExportDates: { Created: "2024-01-01" },
        dateOrderingIssues: undefined as unknown as []
      })
    ).toEqual([{ field: "Created", baseline: "2024-03-01", latest: "2024-01-01" }]);
  });
});
