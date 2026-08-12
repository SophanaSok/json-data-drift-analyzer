import { describe, expect, it } from "vitest";
import baseline from "../test/fixtures/baseline.json";
import latest from "../test/fixtures/latest.json";
import { baselineSnapshot, runAnalysis } from "./diff";
import { buildRecordKey } from "./identity";
import { intersectSets } from "../lib/sets";

// Record ids are the collision-proof identity keys, not the raw field values;
// recordKey remains the human-readable label ("91B-2023").
const idOf = (code: string) => buildRecordKey({ ProjectCode: code }, ["ProjectCode"]).key!;

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

describe("analysis engine progress reporting", () => {
  function collectSteps() {
    const steps: string[] = [];
    runAnalysis({
      baselineData: baseline,
      latestData: latest,
      baselineFileName: "baseline.json",
      latestFileName: "latest.json",
      analysisKey: "progress-key",
      config: {
        collectionPath: "Export",
        identityFields: ["ProjectCode"],
        ignoredFields: [],
        profileId: "default-government-bids"
      },
      onProgress: (step) => steps.push(step)
    });
    return steps;
  }

  it("does not claim to parse — it receives already-parsed data", () => {
    // The worker parses before calling runAnalysis, so reporting "Parsing files"
    // here mislabelled the work and left parse failures with no progress update.
    expect(collectSteps()).not.toContain("Parsing files");
  });

  it("reports reading export metadata as its first step", () => {
    expect(collectSteps()[0]).toBe("Reading export metadata");
  });

  it("emits each step exactly once, never once per record", () => {
    const steps = collectSteps();
    expect(new Set(steps).size).toBe(steps.length);
  });

  it("reports every step it performs, in order", () => {
    expect(collectSteps()).toEqual([
      "Reading export metadata",
      "Detecting record collection",
      "Matching records",
      "Comparing fields and documents",
      "Profiling field health",
      "Building fast indexes"
    ]);
  });
});

describe("analysis engine", () => {
  it("matches by ProjectCode and classifies record statuses", () => {
    const result = getAnalysis();
    expect(result.summary.addedCount).toBe(1);
    expect(result.summary.removedCount).toBe(1);
    expect(result.summary.changedCount).toBe(1);
  });

  it("classifies emptied and restored changes", () => {
    const result = getAnalysis();
    const changed = result.recordsById[idOf("91B-2023")]!;
    const titleChange = changed.changedFields.find((change) => change.path === "Title");
    expect(titleChange?.kind).toBe("emptied");
  });

  it("detects document modifications and incomplete docs", () => {
    const result = getAnalysis();
    const changed = result.recordsById[idOf("91B-2023")]!;
    const diff = changed.documentDiffs.BidDocuments!;
    expect(diff.modifiedCount).toBeGreaterThan(0);
    expect(diff.incompleteCount).toBeGreaterThan(0);
  });

  it("detects header metadata incident and critical quality", () => {
    const result = getAnalysis();
    expect(result.qualityIssues.some((issue) => issue.id === "group-header-metadata")).toBe(true);
    expect(result.narrative).toContain("Bid header metadata");
  });

  it("explains field population issues with both rates and percentage-point change", () => {
    const result = getAnalysis();
    const issue = result.qualityIssues.find((item) => item.kind === "field-population");
    expect(issue?.description).toMatch(/fill rate changed from \d+\.\d% to \d+\.\d% \(-?\d+\.\dpp\)/);
  });

  it("builds set-based filter indexes", () => {
    const result = getAnalysis();
    const ids = intersectSets([result.indexes.byStatus.changed, result.indexes.byChangeKind.emptied]);
    expect(ids.has(idOf("91B-2023"))).toBe(true);
  });

  it("produces stable analysis cache key usage", () => {
    const resultA = getAnalysis();
    const resultB = getAnalysis();
    expect(resultA.analysisKey).toBe(resultB.analysisKey);
  });

  it("stores export date metadata and ordering issues", () => {
    const result = getAnalysis();
    expect(result.metadata.baselineExportDates.Refreshed).toBe("2024-01-10T08:00:00Z");
    expect(result.metadata.latestExportDates.Refreshed).toBe("2024-02-15T08:00:00Z");
    expect(result.metadata.dateOrderingIssues).toEqual([]);
  });

  it("records date ordering issues when baseline export dates are newer", () => {
    const reversedBaseline = {
      Refreshed: "2024-03-01",
      Created: "2024-02-01",
      Export: baseline.Export
    };
    const result = runAnalysis({
      baselineData: reversedBaseline,
      latestData: latest,
      baselineFileName: "baseline.json",
      latestFileName: "latest.json",
      analysisKey: "reversed-key",
      config: {
        collectionPath: "Export",
        identityFields: ["ProjectCode"],
        ignoredFields: [],
        profileId: "default-government-bids"
      }
    });

    expect(result.metadata.dateOrderingIssues).toEqual([
      { field: "Refreshed", baseline: "2024-03-01", latest: "2024-02-15T08:00:00Z" },
      { field: "Created", baseline: "2024-02-01", latest: "2024-01-20T08:00:00Z" }
    ]);
  });

  it("treats document reordering as unchanged", () => {
    const reorderBaseline = { Export: [{ ProjectCode: "R1", BidDocuments: [{ Title: "A", URL: "u1", Hash: "h1" }, { Title: "B", URL: "u2", Hash: "h2" }], BidDocumentHashes: ["h1", "h2"] }] };
    const reorderLatest = { Export: [{ ProjectCode: "R1", BidDocuments: [{ Title: "B", URL: "u2", Hash: "h2" }, { Title: "A", URL: "u1", Hash: "h1" }], BidDocumentHashes: ["h1", "h2"] }] };
    const result = runAnalysis({ baselineData: reorderBaseline, latestData: reorderLatest, baselineFileName: "b", latestFileName: "l", analysisKey: "r", config: { collectionPath: "Export", identityFields: ["ProjectCode"], ignoredFields: [], profileId: "default-government-bids" } });
    expect(result.recordsById[idOf("R1")]!.documentDiffs.BidDocuments!.modifiedCount).toBe(0);
  });
});

describe("records that cannot be identity-keyed", () => {
  // The regression: records with a missing/blank identity all got the key "", so
  // they merged into ONE record (Map last-wins) and the rest silently vanished.
  // A typo'd identity field name collapsed the WHOLE analysis into one record.
  function analyze(baselineData: unknown, latestData: unknown, identityFields: string[]) {
    return runAnalysis({
      baselineData,
      latestData,
      baselineFileName: "b",
      latestFileName: "l",
      analysisKey: "unkeyed",
      config: { collectionPath: "Export", identityFields, ignoredFields: [], profileId: "default-government-bids" }
    });
  }

  it("keeps each unkeyable record visible instead of collapsing them into one", () => {
    const result = analyze(
      { Export: [{ ProjectCode: "", Title: "first" }, { ProjectCode: "", Title: "second" }] },
      { Export: [] },
      ["ProjectCode"]
    );
    expect(result.summary.removedCount).toBe(2);
    expect(result.qualityIssues.some((issue) => issue.id === "unkeyed-records")).toBe(true);
  });

  it("quarantines the run when no record can be keyed — the typo'd-field case", () => {
    const result = analyze(
      { Export: [{ ProjectCode: "A", Title: "x" }] },
      { Export: [{ ProjectCode: "A", Title: "x" }] },
      ["ProjectCod"]
    );
    const issue = result.qualityIssues.find((item) => item.id === "unkeyed-records");
    expect(issue?.severity).toBe("critical");
    expect(issue?.description).toContain("ProjectCod");
    expect(result.summary.qualityGate).toBe("Quarantined");
  });

  it("does not merge records whose identity values forge the old separator", () => {
    const result = analyze(
      { Export: [{ A: "a::b", B: "c" }, { A: "a", B: "b::c" }] },
      { Export: [{ A: "a::b", B: "c" }, { A: "a", B: "b::c" }] },
      ["A", "B"]
    );
    expect(result.summary.unchangedCount).toBe(2);
    expect(result.summary.baselineRecordCount).toBe(2);
  });
});

describe("record bodies are stored once, not per side", () => {
  // The regression this covers: every DiffRecord embedded BOTH full record bodies,
  // so the result graph structured-cloned to the main thread — and written to
  // IndexedDB — carried the datasets several times over.
  const analysis = getAnalysis();
  const records = Object.values(analysis.recordsById);

  it("keeps the baseline body only on removed records", () => {
    for (const record of records) {
      if (record.status === "removed") {
        expect(record.baseline).toBeDefined();
        expect(record.latest).toBeUndefined();
      } else {
        expect(record.baseline).toBeUndefined();
        expect(record.latest).toBeDefined();
      }
    }
    // The fixture exercises every branch this test asserts on.
    const statuses = new Set(records.map((record) => record.status));
    expect(statuses.has("removed")).toBe(true);
    expect(statuses.has("changed")).toBe(true);
  });

  it("derives the baseline snapshot for a changed record from latest + changes", () => {
    const changed = records.find((record) => record.status === "changed")!;
    const derived = baselineSnapshot(changed)!;
    const original = (baseline as { Export: Array<Record<string, unknown>> }).Export.find(
      (record) => record.ProjectCode === changed.recordKey
    );

    expect(derived).toEqual(original);
    // Derivation must not touch the stored latest body.
    expect(changed.latest).not.toEqual(derived);
  });

  it("returns the latest body itself for an unchanged record", () => {
    const unchanged = records.find((record) => record.status === "unchanged");
    if (!unchanged) return; // fixture-dependent; the real-fixture suite covers scale
    expect(baselineSnapshot(unchanged)).toBe(unchanged.latest);
  });

  it("returns undefined for an added record and the stored body for a removed one", () => {
    const added = records.find((record) => record.status === "added")!;
    const removed = records.find((record) => record.status === "removed")!;

    expect(baselineSnapshot(added)).toBeUndefined();
    expect(baselineSnapshot(removed)).toBe(removed.baseline);
  });

  it("prefers a stored baseline body, so results cached before the slimming still render", () => {
    const changed = records.find((record) => record.status === "changed")!;
    const legacyShape = { ...changed, baseline: { Marker: "stored" } };
    expect(baselineSnapshot(legacyShape)).toBe(legacyShape.baseline);
  });
});
