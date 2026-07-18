import { describe, expect, it } from "vitest";
import { extractExportDates, findDateOrderingIssues, formatExportDates } from "./export-metadata";

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

  it("extracts export dates case-insensitively and from nested metadata", () => {
    const dates = extractExportDates({
      metadata: {
        refreshed: "2024-02-01T10:00:00Z",
        created: "2024-01-01T08:00:00Z"
      },
      Export: []
    });

    expect(dates).toEqual({
      Refreshed: "2024-02-01T10:00:00Z",
      Created: "2024-01-01T08:00:00Z"
    });
  });

  it("extracts .NET-style and numeric export dates", () => {
    const dates = extractExportDates({
      Refreshed: "/Date(1706788800000)/",
      Created: 1704067200,
      Export: []
    });

    expect(dates.Refreshed).toBe("2024-02-01T12:00:00.000Z");
    expect(dates.Created).toBe("2024-01-01T00:00:00.000Z");
  });

  it("ignores empty or missing export date fields", () => {
    expect(extractExportDates({ Refreshed: "  ", Export: [] })).toEqual({});
    expect(extractExportDates(null)).toEqual({});
  });

  it("flags baseline dates that are older than latest dates", () => {
    const issues = findDateOrderingIssues(
      { Refreshed: "2024-01-01", Created: "2023-12-01" },
      { Refreshed: "2024-02-01", Created: "2024-01-01" }
    );

    expect(issues).toEqual([
      { field: "Refreshed", baseline: "2024-01-01", latest: "2024-02-01" },
      { field: "Created", baseline: "2023-12-01", latest: "2024-01-01" }
    ]);
  });

  it("does not flag equal baseline and latest dates", () => {
    const issues = findDateOrderingIssues(
      { Created: "2024-01-01" },
      { Created: "2024-01-01" }
    );

    expect(issues).toEqual([]);
  });

  it("does not flag baseline dates that are newer than latest dates", () => {
    const issues = findDateOrderingIssues(
      { Refreshed: "2024-03-01", Created: "2024-02-01" },
      { Refreshed: "2024-02-01", Created: "2024-01-20" }
    );

    expect(issues).toEqual([]);
  });

  it("formats export dates for display", () => {
    expect(formatExportDates({ Refreshed: "2024-01-01" })).toBe("Refreshed: 2024-01-01");
    expect(formatExportDates({})).toBe("No export dates found");
  });
});
