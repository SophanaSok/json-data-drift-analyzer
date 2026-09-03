import { describe, expect, it } from "vitest";
import {
  buildHealthSections,
  countHealthItems,
  DEFAULT_HEALTH_FILTER,
  filterHealthSections,
  isHealthFilterActive
} from "./data-health-model";
import { createFinding, type Finding, type FindingCategory, type FindingSeverity } from "../../engine/findings";
import { runAnalysis } from "../../engine/diff";
import { runRecoveryReview } from "../../engine/review";
import { BELLINGHAM_PROCUREWARE } from "../../profiles";
import type { AnalysisResult, QualityIssue } from "../../engine/types";
import baseline from "../../test/fixtures/baseline.json";
import latest from "../../test/fixtures/latest.json";

const analysis = runAnalysis({
  baselineData: baseline,
  latestData: latest,
  baselineFileName: "baseline.json",
  latestFileName: "latest.json",
  analysisKey: "fixture-key",
  config: { collectionPath: "Export", identityFields: ["ProjectCode"], ignoredFields: [], profileId: "default-government-bids" }
});

/** A real review, so the shape under test is the one the app actually holds. */
const baseReview = runRecoveryReview(
  [{ AgentID: "1431", ProjectCode: "1B-2026", BidURL: "https://cob.procureware.com/Bids/a", Title: "Water Main" }],
  [{ AgentID: "1431", ProjectCode: "1B-2026", BidURL: "https://cob.procureware.com/Bids/a", Title: "" }],
  BELLINGHAM_PROCUREWARE,
  { generatedAt: "2026-09-03T00:00:00.000Z" }
);

const reviewWith = (findings: Finding[]) => ({ ...baseReview, qa: { ...baseReview.qa, findings } });

function finding(category: FindingCategory, severity: FindingSeverity, fieldPath: string | null, message = "m"): Finding {
  return createFinding({
    severity,
    category,
    fieldPath,
    recordKey: null,
    candidateValue: null,
    referenceValue: null,
    message,
    evidence: {},
    recommendedAction: "report_only",
    discriminator: `${severity}:${fieldPath}:${message}`
  });
}

function analysisWith(issues: QualityIssue[]): AnalysisResult {
  return { ...analysis, qualityIssues: issues };
}

const issue = (overrides: Partial<QualityIssue> = {}): QualityIssue => ({
  id: "issue-1",
  kind: "population-drop",
  severity: "critical",
  title: "Title population collapsed",
  description: "Title fell from 100% to 0%.",
  relatedFields: ["Title"],
  relatedRecordIds: ["r1", "r2"],
  ...overrides
});

describe("health sections", () => {
  it("orders sections worst-first and drops empty ones", () => {
    const sections = buildHealthSections(
      analysisWith([issue(), issue({ id: "issue-2", severity: "info", title: "FYI" })]),
      reviewWith([finding("field_conflict", "medium", "BidType")])
    );
    expect(sections.map((section) => section.severity)).toEqual(["critical", "medium", "info"]);
  });

  it("maps the drift engine's scale down onto the QA one without promoting anything", () => {
    const sections = buildHealthSections(
      analysisWith([
        issue({ id: "w", severity: "warning", title: "Warned" }),
        issue({ id: "p", severity: "pass", title: "Passed" })
      ]),
      null
    );
    const bySeverity = Object.fromEntries(
      sections.map((section) => [section.severity, section.items.map((item) => item.title)])
    );
    expect(bySeverity.medium).toEqual(["Warned"]);
    expect(bySeverity.info).toEqual(["Passed"]);
    expect(bySeverity.critical).toBeUndefined();
  });

  it("rolls findings up per category, keeping the exact count and the worst severity", () => {
    const sections = buildHealthSections(
      analysisWith([]),
      reviewWith([
        finding("field_regression", "high", "Title", "a"),
        finding("field_regression", "medium", "BidType", "b"),
        finding("field_regression", "high", "Title", "c"),
        finding("record_count_anomaly", "info", null, "count")
      ])
    );
    const regression = sections
      .flatMap((section) => section.items)
      .find((item) => item.id === "finding:field_regression");
    expect(regression?.severity).toBe("high");
    expect(regression?.count).toBe(3);
    expect(regression?.fields).toEqual(["BidType", "Title"]);
    expect(regression?.detail).toContain("3 findings across 2 fields");
    expect(countHealthItems(sections)).toBe(2);
  });

  it("uses the finding's own message when a category has exactly one", () => {
    const sections = buildHealthSections(
      analysisWith([]),
      reviewWith([finding("record_count_anomaly", "info", null, "500 → 499 records")])
    );
    expect(sections[0]?.items[0]?.detail).toBe("500 → 499 records");
  });

  it("does not offer a composite key path as an Explore link", () => {
    // "AgentID,BidURL" names a key definition; Explore opens fields.
    const sections = buildHealthSections(
      analysisWith([]),
      reviewWith([finding("duplicate_identity_key", "high", "AgentID,BidURL")])
    );
    expect(sections[0]?.items[0]?.fields).toEqual([]);
  });

  it("points each row at somewhere it can be acted on", () => {
    const sections = buildHealthSections(
      analysisWith([issue()]),
      reviewWith([finding("record_missing_from_candidate", "high", null)])
    );
    const items = sections.flatMap((section) => section.items);
    expect(items.find((item) => item.id === "quality:issue-1")?.link?.to).toBe("/results?tab=records&field=Title");
    expect(items.find((item) => item.id === "finding:record_missing_from_candidate")?.link?.to).toBe(
      "/results?tab=records&status=removed"
    );
  });

  it("carries no link for an issue that names no field", () => {
    const sections = buildHealthSections(analysisWith([issue({ relatedFields: [] })]), null);
    expect(sections[0]?.items[0]?.link).toBeNull();
  });

  it("still lists drift issues when the run has no recovery review", () => {
    const sections = buildHealthSections(analysisWith([issue()]), null);
    expect(countHealthItems(sections)).toBe(1);
  });

  it("returns nothing for a run with no issues and no findings", () => {
    expect(buildHealthSections(analysisWith([]), reviewWith([]))).toEqual([]);
  });
});

describe("health filters", () => {
  const sections = buildHealthSections(
    analysisWith([issue()]),
    reviewWith([finding("field_conflict", "medium", "BidType", "conflicting BidType")])
  );

  it("passes everything through by default", () => {
    expect(filterHealthSections(sections, DEFAULT_HEALTH_FILTER)).toEqual(sections);
    expect(isHealthFilterActive(DEFAULT_HEALTH_FILTER)).toBe(false);
  });

  it("keeps only the requested severity", () => {
    const filtered = filterHealthSections(sections, { ...DEFAULT_HEALTH_FILTER, severity: "medium" });
    expect(filtered.map((section) => section.severity)).toEqual(["medium"]);
  });

  it("searches title, detail, and field names, case-insensitively", () => {
    expect(countHealthItems(filterHealthSections(sections, { severity: "all", search: "bidtype" }))).toBe(1);
    expect(countHealthItems(filterHealthSections(sections, { severity: "all", search: "collapsed" }))).toBe(1);
    expect(countHealthItems(filterHealthSections(sections, { severity: "all", search: "nothing here" }))).toBe(0);
  });

  it("also matches the engine's own category name, which is what a reader has seen elsewhere", () => {
    // "Field lost in every matched record" is the human title; the CSV, the
    // ticket, and the Recovery filters all call it systemic_field_regression.
    const withSystemic = buildHealthSections(
      analysisWith([]),
      reviewWith([finding("systemic_field_regression", "high", "Title")])
    );
    expect(countHealthItems(filterHealthSections(withSystemic, { severity: "all", search: "systemic" }))).toBe(1);
  });

  it("treats a whitespace-only search as no search", () => {
    expect(filterHealthSections(sections, { severity: "all", search: "   " })).toEqual(sections);
    expect(isHealthFilterActive({ severity: "all", search: "   " })).toBe(false);
  });
});
