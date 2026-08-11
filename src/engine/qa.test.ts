import { describe, expect, it } from "vitest";
import { runQa, valuesEqual, type QaReport } from "./qa";
import { resolveRecommendedAction, stableFindingId, summarizeFindings, type Finding, type FindingCategory } from "./findings";
import type { SourceProfile } from "./adapter-types";
import { BELLINGHAM_PROCUREWARE } from "../profiles";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const FIXED_NOW = "2026-08-10T00:00:00.000Z";

/** The approved Bellingham policy, loaded from the single source of truth. */
const bellinghamProfile: SourceProfile = BELLINGHAM_PROCUREWARE;

/** Deliberately generic: no source-specific field names. */
const genericProfile: SourceProfile = {
  id: "generic-test-source",
  version: 3,
  collectionPath: "$",
  primaryKey: ["Id"],
  fallbackKeys: [],
  dedupeKey: ["Id"],
  hardRequiredFields: ["Id"],
  safeBackfillFields: [],
  manualReviewFields: [],
  excludedFields: [],
  minimumMatchRate: 0
};

const rec = (overrides: Record<string, unknown> = {}) => ({ Id: "a", ...overrides });

const run = (
  reference: Array<Record<string, unknown>>,
  candidate: Array<Record<string, unknown>>,
  profile: SourceProfile = genericProfile,
  options = {}
) => runQa(reference, candidate, profile, { generatedAt: FIXED_NOW, ...options });

const of = (report: QaReport, category: FindingCategory): Finding[] =>
  report.findings.filter((finding) => finding.category === category);

describe("findings: identifiers and action resolution", () => {
  it("produces stable ids across runs for identical input", () => {
    const a = run([rec({ V: "x" })], [rec({ V: "" })]);
    const b = run([rec({ V: "x" })], [rec({ V: "" })]);
    expect(a.findings.map((f) => f.id)).toEqual(b.findings.map((f) => f.id));
  });

  it("varies the id with category, record, field, and discriminator", () => {
    const base = stableFindingId("field_regression", "k", "F");
    expect(stableFindingId("field_conflict", "k", "F")).not.toBe(base);
    expect(stableFindingId("field_regression", "other", "F")).not.toBe(base);
    expect(stableFindingId("field_regression", "k", "G")).not.toBe(base);
    expect(stableFindingId("field_regression", "k", "F", "1")).not.toBe(base);
    expect(stableFindingId("field_regression", "k", "F")).toBe(base);
  });

  it("prefixes the id with the category for readability", () => {
    expect(stableFindingId("field_regression", "k", "F")).toMatch(/^field_regression:[0-9a-f]{8}$/);
  });

  it("resolves the recommended action from the profile alone", () => {
    const profile: SourceProfile = {
      ...genericProfile,
      excludedFields: ["Excluded"],
      safeBackfillFields: ["Backfillable"],
      manualReviewFields: ["Reviewable"]
    };

    expect(resolveRecommendedAction(profile, "Excluded", { candidateIsBlank: true })).toBe("exclude");
    expect(resolveRecommendedAction(profile, "Backfillable", { candidateIsBlank: true })).toBe("backfill_allowed");
    expect(resolveRecommendedAction(profile, "Reviewable", { candidateIsBlank: true })).toBe("manual_review");
    expect(resolveRecommendedAction(profile, "Unlisted", { candidateIsBlank: true })).toBe("report_only");
    expect(resolveRecommendedAction(profile, null)).toBe("report_only");
  });

  it("never permits backfill over a non-blank candidate value, even when the field is listed", () => {
    const profile: SourceProfile = { ...genericProfile, safeBackfillFields: ["Backfillable"] };
    expect(resolveRecommendedAction(profile, "Backfillable", { candidateIsBlank: false })).toBe("manual_review");
  });

  it("summarizes by severity and category", () => {
    const report = run([rec({ V: "x" })], [rec({ V: "" })]);
    const counts = summarizeFindings(report.findings);
    expect(counts.total).toBe(report.findings.length);
    expect(Object.values(counts.byCategory).reduce((a, b) => a + b, 0)).toBe(counts.total);
    expect(Object.values(counts.bySeverity).reduce((a, b) => a + b, 0)).toBe(counts.total);
  });
});

describe("qa: required field missing or blank", () => {
  it("flags an absent required field as critical", () => {
    const report = run([], [{ Other: "x" }]);
    const finding = of(report, "required_field_missing")[0];

    expect(finding.severity).toBe("critical");
    expect(finding.fieldPath).toBe("Id");
    expect(finding.message).toContain("absent");
    expect(finding.candidateValue).toBeNull();
  });

  it("flags a blank required field", () => {
    const report = run([], [{ Id: "   " }]);
    expect(of(report, "required_field_missing")).toHaveLength(1);
    expect(of(report, "required_field_missing")[0].message).toContain("unpopulated");
  });

  it("treats a placeholder as unpopulated for reporting", () => {
    // Reporting policy, not the rule 4 backfill gate — see src/engine/empty.ts.
    const report = run([], [{ Id: "N/A" }]);
    expect(of(report, "required_field_missing")).toHaveLength(1);
  });

  it("does not flag a populated required field", () => {
    const report = run([rec()], [rec()]);
    expect(of(report, "required_field_missing")).toHaveLength(0);
  });
});

describe("qa: configured type and format validation", () => {
  const withValidation = (validation: SourceProfile["validation"]): SourceProfile => ({
    ...genericProfile,
    validation
  });

  it("validates only fields the profile configures", () => {
    const profile = withValidation({ urlFields: ["Link"] });
    const report = run([], [rec({ Link: "not a url", Other: "also not a url" })], profile);

    const failures = of(report, "field_validation_failure");
    expect(failures).toHaveLength(1);
    expect(failures[0].fieldPath).toBe("Link");
  });

  it("reports JSON and URL failures at medium severity", () => {
    const profile = withValidation({ jsonFields: ["Payload"], urlFields: ["Link"] });
    const report = run([], [rec({ Payload: "{oops", Link: "ftp://x.test/a" })], profile);

    const failures = of(report, "field_validation_failure");
    expect(failures).toHaveLength(2);
    for (const failure of failures) {
      expect(failure.severity).toBe("medium");
    }
    expect(failures.find((f) => f.fieldPath === "Link")?.message).toContain("not http or https");
  });

  it("accepts valid JSON, URL, and date values", () => {
    const profile = withValidation({
      jsonFields: ["Payload"],
      urlFields: ["Link"],
      dateFields: ["When"]
    });
    const report = run([], [rec({ Payload: "[]", Link: "https://x.test/a", When: "8/4/2026 11:00 AM" })], profile);
    expect(of(report, "field_validation_failure")).toHaveLength(0);
  });

  it("reports email and phone heuristics at low severity and marks them as heuristic", () => {
    const profile = withValidation({ emailFields: ["Mail"], phoneFields: ["Tel"] });
    const report = run([], [rec({ Mail: "nope", Tel: "no digits here" })], profile);

    const failures = of(report, "field_validation_failure");
    expect(failures).toHaveLength(2);
    for (const failure of failures) {
      expect(failure.severity).toBe("low");
      expect(failure.evidence.heuristic).toBe(true);
    }
  });

  it("escalates to high when the invalid field is also hard-required", () => {
    const profile: SourceProfile = {
      ...genericProfile,
      hardRequiredFields: ["Id", "Link"],
      validation: { urlFields: ["Link"] }
    };
    const report = run([], [rec({ Link: "not a url" })], profile);
    expect(of(report, "field_validation_failure")[0].severity).toBe("high");
  });

  it("does not validate blank values — that is the required-field check's job", () => {
    const profile = withValidation({ urlFields: ["Link"] });
    const report = run([], [rec({ Link: "" })], profile);
    expect(of(report, "field_validation_failure")).toHaveLength(0);
  });

  it("flags a non-string value in a field configured for a string format", () => {
    const profile = withValidation({ urlFields: ["Link"] });
    const report = run([], [rec({ Link: 42 })], profile);

    const failure = of(report, "field_validation_failure")[0];
    expect(failure.message).toContain("holds a number");
  });

  it("validates nothing when the profile configures nothing", () => {
    const report = run([], [rec({ Link: "not a url" })]);
    expect(of(report, "field_validation_failure")).toHaveLength(0);
  });
});

describe("qa: field regression against a matched reference", () => {
  it("flags a value that was present in the reference and is blank in the candidate", () => {
    const report = run([rec({ Title: "Kept" })], [rec({ Title: "" })]);
    const regression = of(report, "field_regression")[0];

    expect(regression.severity).toBe("high");
    expect(regression.fieldPath).toBe("Title");
    expect(regression.referenceValue).toBe("Kept");
    expect(regression.candidateValue).toBe("");
    expect(regression.evidence.matchMethod).toBe("primary");
  });

  it("escalates a regression on a hard-required field to critical", () => {
    const profile: SourceProfile = { ...genericProfile, hardRequiredFields: ["Id", "Title"] };
    const report = run([rec({ Title: "Kept" })], [rec({ Title: "" })], profile);
    expect(of(report, "field_regression")[0].severity).toBe("critical");
  });

  it("marks a regression backfill_allowed only when the profile permits the field", () => {
    const permitted: SourceProfile = { ...genericProfile, safeBackfillFields: ["Title"] };
    expect(of(run([rec({ Title: "Kept" })], [rec({ Title: "" })], permitted), "field_regression")[0].recommendedAction).toBe(
      "backfill_allowed"
    );
    expect(of(run([rec({ Title: "Kept" })], [rec({ Title: "" })]), "field_regression")[0].recommendedAction).toBe(
      "report_only"
    );
  });

  it("does not treat a placeholder candidate value as backfillable", () => {
    // isEmpty says blank (so it is a regression); rule 4's strict gate says not blank.
    const permitted: SourceProfile = { ...genericProfile, safeBackfillFields: ["Title"] };
    const report = run([rec({ Title: "Kept" })], [rec({ Title: "N/A" })], permitted);
    const regression = of(report, "field_regression")[0];

    expect(regression).toBeDefined();
    expect(regression.recommendedAction).toBe("manual_review");
  });

  it("ignores excluded fields", () => {
    const profile: SourceProfile = { ...genericProfile, excludedFields: ["Stamp"] };
    const report = run([rec({ Stamp: "then" })], [rec({ Stamp: "" })], profile);
    expect(of(report, "field_regression")).toHaveLength(0);
  });

  it("does not report a regression when the reference was already blank", () => {
    const report = run([rec({ Title: "" })], [rec({ Title: "" })]);
    expect(of(report, "field_regression")).toHaveLength(0);
  });

  it("only compares matched pairs", () => {
    const report = run([rec({ Id: "a", Title: "Kept" })], [rec({ Id: "b", Title: "" })]);
    expect(of(report, "field_regression")).toHaveLength(0);
  });
});

describe("qa: field conflict against a matched reference", () => {
  it("flags two differing non-blank values at medium severity", () => {
    const report = run([rec({ Title: "Old" })], [rec({ Title: "New" })]);
    const conflict = of(report, "field_conflict")[0];

    expect(conflict.severity).toBe("medium");
    expect(conflict.referenceValue).toBe("Old");
    expect(conflict.candidateValue).toBe("New");
    expect(conflict.recommendedAction).toBe("manual_review");
  });

  it("never recommends backfill for a conflict, even on a permitted field", () => {
    const permitted: SourceProfile = { ...genericProfile, safeBackfillFields: ["Title"] };
    const report = run([rec({ Title: "Old" })], [rec({ Title: "New" })], permitted);
    expect(of(report, "field_conflict")[0].recommendedAction).toBe("manual_review");
  });

  it("does not flag identical values", () => {
    const report = run([rec({ Title: "Same" })], [rec({ Title: "Same" })]);
    expect(of(report, "field_conflict")).toHaveLength(0);
  });

  it("does not report a false conflict for objects differing only in key order", () => {
    // This source is flat and all-string, so the case cannot arise today. The guard
    // exists so the engine stays correct for a source whose values are structured.
    const reference = [rec({ Blob: { a: 1, b: 2 } })];
    const candidate = [rec({ Blob: { b: 2, a: 1 } })];
    expect(of(run(reference, candidate), "field_conflict")).toHaveLength(0);
  });

  it("still reports a genuine difference inside a nested value", () => {
    const reference = [rec({ Blob: { a: 1, b: 2 } })];
    const candidate = [rec({ Blob: { a: 1, b: 3 } })];
    expect(of(run(reference, candidate), "field_conflict")).toHaveLength(1);
  });

  it("treats array order as significant", () => {
    expect(valuesEqual([1, 2], [2, 1])).toBe(false);
    expect(valuesEqual([1, 2], [1, 2])).toBe(true);
  });

  it("compares scalars exactly", () => {
    expect(valuesEqual("a", "a")).toBe(true);
    expect(valuesEqual("a", "b")).toBe(false);
    expect(valuesEqual(1, "1")).toBe(false);
    expect(valuesEqual(null, undefined)).toBe(false);
    expect(valuesEqual(null, null)).toBe(true);
  });

  it("compares nested structures irrespective of key order at every depth", () => {
    expect(valuesEqual({ x: { a: 1, b: 2 } }, { x: { b: 2, a: 1 } })).toBe(true);
    expect(valuesEqual([{ a: 1, b: 2 }], [{ b: 2, a: 1 }])).toBe(true);
  });

  it("ignores excluded fields", () => {
    const profile: SourceProfile = { ...genericProfile, excludedFields: ["Stamp"] };
    const report = run([rec({ Stamp: "then" })], [rec({ Stamp: "now" })], profile);
    expect(of(report, "field_conflict")).toHaveLength(0);
  });
});

describe("qa: schema field disappearance", () => {
  it("flags a field present in the reference schema and absent from every candidate record", () => {
    const report = run([rec({ Gone: "value" })], [rec()]);
    const finding = of(report, "schema_field_missing")[0];

    expect(finding.severity).toBe("high");
    expect(finding.fieldPath).toBe("Gone");
    expect(finding.recordKey).toBeNull();
    expect(finding.evidence.referenceRecordsWithField).toBe(1);
  });

  it("does not flag a field that survives in any candidate record", () => {
    const report = run([rec({ Kept: "v" }), rec({ Id: "b", Kept: "v" })], [rec({ Kept: "v" }), rec({ Id: "b" })]);
    expect(of(report, "schema_field_missing")).toHaveLength(0);
  });

  it("downgrades an excluded field to informational", () => {
    const profile: SourceProfile = { ...genericProfile, excludedFields: ["Gone"] };
    const report = run([rec({ Gone: "v" })], [rec()], profile);
    const finding = of(report, "schema_field_missing")[0];

    expect(finding.severity).toBe("info");
    expect(finding.recommendedAction).toBe("exclude");
  });
});

describe("qa: duplicate identity and dedupe keys", () => {
  it("flags duplicates on the candidate side", () => {
    const report = run([], [rec(), rec()]);
    const duplicate = of(report, "duplicate_identity_key")[0];

    expect(duplicate.severity).toBe("high");
    expect(duplicate.evidence.side).toBe("candidate");
    expect(duplicate.evidence.recordIndexes).toEqual([0, 1]);
    expect(duplicate.recommendedAction).toBe("manual_review");
  });

  it("flags duplicates on the reference side", () => {
    const report = run([rec(), rec()], []);
    expect(of(report, "duplicate_identity_key")[0].evidence.side).toBe("reference");
  });

  it("reports once when primaryKey and dedupeKey are identical", () => {
    const report = run([], [rec(), rec()]);
    expect(of(report, "duplicate_identity_key")).toHaveLength(1);
  });

  it("reports both definitions when dedupeKey differs from primaryKey", () => {
    const profile: SourceProfile = { ...genericProfile, primaryKey: ["Id"], dedupeKey: ["Group"] };
    const report = run([], [rec({ Id: "a", Group: "g" }), rec({ Id: "a", Group: "g" })], profile);

    const definitions = of(report, "duplicate_identity_key").map((f) => f.evidence.keyDefinition);
    expect(new Set(definitions)).toEqual(new Set(["primaryKey", "dedupeKey"]));
  });

  it("does not flag unkeyable records as duplicates of each other", () => {
    const report = run([], [{ Id: "" }, { Id: "" }]);
    expect(of(report, "duplicate_identity_key")).toHaveLength(0);
  });
});

describe("qa: record-count anomaly", () => {
  it("reports a count difference at informational severity with no configured tolerance", () => {
    const report = run([rec(), rec({ Id: "b" })], [rec()]);
    const anomaly = of(report, "record_count_anomaly")[0];

    expect(anomaly.severity).toBe("info");
    expect(anomaly.candidateValue).toBe(1);
    expect(anomaly.referenceValue).toBe(2);
    expect(anomaly.evidence.delta).toBe(-1);
    expect(anomaly.evidence.toleranceConfigured).toBe(false);
    expect(anomaly.recommendedAction).toBe("report_only");
  });

  it("escalates when drift exceeds a configured tolerance", () => {
    const profile: SourceProfile = { ...genericProfile, recordCountTolerance: 0.1 };
    const report = run([rec(), rec({ Id: "b" })], [rec()], profile);
    const anomaly = of(report, "record_count_anomaly")[0];

    expect(anomaly.severity).toBe("high");
    expect(anomaly.evidence.exceedsTolerance).toBe(true);
  });

  it("stays informational when drift is inside the tolerance", () => {
    const profile: SourceProfile = { ...genericProfile, recordCountTolerance: 0.9 };
    const report = run([rec(), rec({ Id: "b" })], [rec()], profile);
    expect(of(report, "record_count_anomaly")[0].severity).toBe("info");
  });

  it("reports nothing when the counts agree", () => {
    const report = run([rec()], [rec()]);
    expect(of(report, "record_count_anomaly")).toHaveLength(0);
  });
});

describe("qa: ambiguous or invalid identity", () => {
  it("flags an ambiguous match for manual review", () => {
    const report = run([rec(), rec()], [rec()]);
    const issues = of(report, "identity_match_issue");

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].severity).toBe("high");
    expect(issues[0].recommendedAction).toBe("manual_review");
    expect(issues[0].evidence.status).toBe("ambiguous_primary");
  });

  it("recommends excluding a record that cannot be keyed", () => {
    const report = run([], [{ Id: "  " }]);
    const invalid = of(report, "identity_match_issue")[0];

    expect(invalid.evidence.status).toBe("invalid_identity");
    expect(invalid.recommendedAction).toBe("exclude");
  });

  it("flags a match rate below the profile minimum", () => {
    const profile: SourceProfile = { ...genericProfile, minimumMatchRate: 0.95 };
    const report = run([rec()], [rec(), rec({ Id: "b" })], profile);
    const belowMinimum = of(report, "identity_match_issue").find(
      (f) => f.evidence.minimumMatchRate !== undefined
    );

    expect(belowMinimum).toBeDefined();
    expect(belowMinimum?.severity).toBe("high");
  });
});

describe("qa: report envelope", () => {
  it("carries the provenance rule 7 requires", () => {
    const report = run([rec()], [rec()], bellinghamProfile, {
      sourceRun: "candidate.json",
      referenceRun: "reference.json"
    });

    expect(report.profileId).toBe("bellingham-procureware");
    expect(report.profileVersion).toBe(bellinghamProfile.version);
    expect(report.generatedAt).toBe(FIXED_NOW);
    expect(report.sourceRun).toBe("candidate.json");
    expect(report.referenceRun).toBe("reference.json");
    expect(report.matchingKey).toEqual(["AgentID", "BidURL"]);
  });

  it("does not mutate the input records", () => {
    const reference = [rec({ Title: "Old" })];
    const candidate = [rec({ Title: "" })];
    const before = JSON.stringify([reference, candidate]);

    run(reference, candidate);

    expect(JSON.stringify([reference, candidate])).toBe(before);
  });

  it("reuses a supplied match report rather than recomputing", () => {
    const first = run([rec({ Title: "Old" })], [rec({ Title: "" })]);
    const second = run([rec({ Title: "Old" })], [rec({ Title: "" })], genericProfile, {
      matchReport: first.matchReport
    });

    expect(second.matchReport).toBe(first.matchReport);
    expect(second.findings.map((f) => f.id)).toEqual(first.findings.map((f) => f.id));
  });
});

describe("qa: real Bellingham fixtures", () => {
  const report = runQa(referenceRecords, candidateRecords, bellinghamProfile, {
    generatedAt: FIXED_NOW,
    sourceRun: "lambda-20260715-080212-d3836a0d.json",
    referenceRun: "lambda-20260714-194920-c3177c97.json"
  });

  it("detects the known blank-field regression across all eight fields", () => {
    const regressedFields = [
      "Title",
      "BidStatus",
      "BidType",
      "PublishedDate",
      "DueDate",
      "AwardDate",
      "ContactEmail",
      "ContactPhone"
    ];

    const byField = new Map<string, Finding[]>();
    for (const finding of of(report, "field_regression")) {
      const bucket = byField.get(finding.fieldPath as string) ?? [];
      bucket.push(finding);
      byField.set(finding.fieldPath as string, bucket);
    }

    // Title, BidStatus, DueDate, PublishedDate held a value in all 499 matched
    // references; the rest were populated less often. See the forensic report.
    expect(byField.get("Title")).toHaveLength(499);
    expect(byField.get("BidStatus")).toHaveLength(499);
    expect(byField.get("DueDate")).toHaveLength(499);
    expect(byField.get("PublishedDate")).toHaveLength(499);
    expect(byField.get("BidType")).toHaveLength(495);
    expect(byField.get("AwardDate")).toHaveLength(487);
    expect(byField.get("ContactEmail")).toHaveLength(242);
    expect(byField.get("ContactPhone")).toHaveLength(171);

    for (const field of regressedFields) {
      expect(byField.get(field)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("permits backfill only for the approved fields", () => {
    const permitted = new Set(
      of(report, "field_regression")
        .filter((f) => f.recommendedAction === "backfill_allowed")
        .map((f) => f.fieldPath)
    );
    expect(permitted).toEqual(new Set(["ContactPhone", "ContactEmail", "BidType", "Title"]));
  });

  it("still refuses backfill for every unapproved regressed field", () => {
    for (const field of ["BidStatus", "PublishedDate", "DueDate", "AwardDate"]) {
      const actions = new Set(
        of(report, "field_regression").filter((f) => f.fieldPath === field).map((f) => f.recommendedAction)
      );
      expect(actions.has("backfill_allowed"), `${field} must not be backfillable`).toBe(false);
    }
  });

  it("carries reference and candidate values as evidence on each regression", () => {
    const title = of(report, "field_regression").find((f) => f.fieldPath === "Title");
    expect(typeof title?.referenceValue).toBe("string");
    expect(title?.referenceValue).not.toBe("");
    expect(title?.candidateValue).toBe("");
    expect(title?.recordKey).toContain("1431");
  });

  it("does not report the excluded run stamps as conflicts", () => {
    const conflicted = of(report, "field_conflict").map((f) => f.fieldPath);
    expect(conflicted).not.toContain("Created");
    expect(conflicted).not.toContain("Refreshed");
  });

  it("reports the two emptied document arrays as conflicts, not regressions", () => {
    // Candidate holds "[]" — a non-blank string — so rule 3 keeps it out of backfill.
    const documentConflicts = of(report, "field_conflict").filter((f) => f.fieldPath === "BidDocuments");
    expect(documentConflicts).toHaveLength(2);
    expect(documentConflicts[0].candidateValue).toBe("[]");
    expect(documentConflicts[0].recommendedAction).toBe("manual_review");
  });

  it("reports the single genuine description edit as a conflict", () => {
    const descriptionConflicts = of(report, "field_conflict").filter((f) => f.fieldPath === "Description");
    expect(descriptionConflicts).toHaveLength(1);
    expect(String(descriptionConflicts[0].referenceValue)).toContain("July 29");
    expect(String(descriptionConflicts[0].candidateValue)).toContain("August 4th");
  });

  it("finds no required-field, schema, duplicate, or identity problems", () => {
    expect(of(report, "required_field_missing")).toHaveLength(0);
    expect(of(report, "schema_field_missing")).toHaveLength(0);
    expect(of(report, "duplicate_identity_key")).toHaveLength(0);
    expect(of(report, "identity_match_issue")).toHaveLength(0);
  });

  it("reports no record-count anomaly — both exports hold 500 records", () => {
    expect(of(report, "record_count_anomaly")).toHaveLength(0);
  });

  it("produces stable ids with no collisions", () => {
    const ids = report.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("counts every finding exactly once", () => {
    expect(report.counts.total).toBe(report.findings.length);
    expect(Object.values(report.counts.byCategory).reduce((a, b) => a + b, 0)).toBe(report.findings.length);
  });
});

describe("qa: a record that disappeared from the candidate", () => {
  it("is reported per record even when a 1:1 swap keeps the counts equal", () => {
    // The regression this covers: reference_only match results produced no finding
    // at all, so a dropped record with equal record counts was invisible in the
    // findings, the CSV, and the contractor ticket.
    const reference = [rec({ Id: "a" }), rec({ Id: "dropped" })];
    const candidate = [rec({ Id: "a" }), rec({ Id: "gained" })];

    const report = run(reference, candidate);
    expect(of(report, "record_count_anomaly")).toHaveLength(0);

    const missing = of(report, "record_missing_from_candidate");
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe("high");
    expect(missing[0].recordKey).toContain("dropped");
    expect(missing[0].message).toContain("absent from the candidate");
  });

  it("is not reported when every reference record has a counterpart", () => {
    const report = run([rec()], [rec()]);
    expect(of(report, "record_missing_from_candidate")).toHaveLength(0);
  });

  it("names the real dropped record 3B-2018 in the Bellingham pair", () => {
    const report = runQa(referenceRecords, candidateRecords, bellinghamProfile, { generatedAt: FIXED_NOW });
    const missing = of(report, "record_missing_from_candidate");

    expect(missing).toHaveLength(1);
    const dropped = referenceRecords.find(
      (record) => record.BidURL && missing[0].recordKey?.includes(String(record.BidURL))
    );
    expect(dropped?.ProjectCode).toBe("3B-2018");
  });
});

describe("qa: systemic field regression", () => {
  it("reports total loss of a field as a dataset-level finding", () => {
    const reference = [rec({ Note: "a" }), rec({ Id: "b", Note: "b" })];
    const candidate = [rec({ Note: "" }), rec({ Id: "b", Note: "" })];

    const report = run(reference, candidate);
    const systemic = of(report, "systemic_field_regression");

    expect(systemic).toHaveLength(1);
    expect(systemic[0].fieldPath).toBe("Note");
    expect(systemic[0].severity).toBe("high");
    expect(systemic[0].message).toContain("all 2 matched record(s)");
    expect(systemic[0].evidence.referencePopulated).toBe(2);
  });

  it("does not fire below total loss — partial loss stays per-record only", () => {
    // No invented threshold: one surviving value means the extraction routine is
    // not uniformly broken, and the per-record findings already carry the counts.
    const reference = [rec({ Note: "a" }), rec({ Id: "b", Note: "b" })];
    const candidate = [rec({ Note: "" }), rec({ Id: "b", Note: "kept" })];

    const report = run(reference, candidate);
    expect(of(report, "field_regression")).toHaveLength(1);
    expect(of(report, "systemic_field_regression")).toHaveLength(0);
  });

  it("does not fire for a field the reference never populated", () => {
    const report = run([rec({ Note: "" })], [rec({ Note: "" })]);
    expect(of(report, "systemic_field_regression")).toHaveLength(0);
  });

  it("samples per-record findings for a systemic loss instead of materializing one per cell", () => {
    // The regression this covers: a field wiped across a large export produced one
    // finding object per cell — an 8-field loss over 100k records is ~800k objects,
    // OOMing the tab on exactly the incident the tool exists to diagnose.
    const size = 620; // above the 500-exemplar cap
    const reference = Array.from({ length: size }, (_, index) => rec({ Id: `r${index}`, Note: `v${index}` }));
    const candidate = Array.from({ length: size }, (_, index) => rec({ Id: `r${index}`, Note: "" }));

    const report = run(reference, candidate);

    const perRecord = of(report, "field_regression").filter((finding) => finding.fieldPath === "Note");
    expect(perRecord).toHaveLength(500);
    expect(perRecord[0].evidence.sampledExemplar).toBe(true);
    expect(perRecord[0].evidence.totalRegressedCount).toBe(size);

    const systemic = of(report, "systemic_field_regression").find((finding) => finding.fieldPath === "Note");
    // The exact counts survive on the dataset-level finding.
    expect(systemic?.evidence.referencePopulated).toBe(size);
    expect(systemic?.evidence.regressed).toBe(size);
    expect(systemic?.evidence.perRecordFindingCount).toBe(500);
    expect(systemic?.message).toContain("sampled to 500 exemplar(s)");
  });

  it("keeps every per-record finding for a partial loss — sampling applies to systemic fields only", () => {
    const size = 520;
    const reference = Array.from({ length: size }, (_, index) => rec({ Id: `r${index}`, Note: `v${index}` }));
    const candidate = Array.from({ length: size }, (_, index) =>
      // One survivor: the loss is no longer total, so nothing may be sampled away.
      rec({ Id: `r${index}`, Note: index === 0 ? "kept" : "" })
    );

    const report = run(reference, candidate);
    expect(of(report, "field_regression").filter((finding) => finding.fieldPath === "Note")).toHaveLength(size - 1);
    expect(of(report, "systemic_field_regression")).toHaveLength(0);
  });

  it("names exactly the eight wiped fields on the real Bellingham pair", () => {
    const report = runQa(referenceRecords, candidateRecords, bellinghamProfile, { generatedAt: FIXED_NOW });
    const systemic = of(report, "systemic_field_regression");

    expect(systemic.map((finding) => finding.fieldPath).sort()).toEqual([
      "AwardDate",
      "BidStatus",
      "BidType",
      "ContactEmail",
      "ContactPhone",
      "DueDate",
      "PublishedDate",
      "Title"
    ]);
    // Loss is measured against populated reference values, per the forensic report.
    const contactPhone = systemic.find((finding) => finding.fieldPath === "ContactPhone");
    expect(contactPhone?.evidence.referencePopulated).toBe(171);
  });
});
