import { describe, expect, it } from "vitest";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";
import { runAnalysis } from "./diff";
import { classifyCells, cellId, createDecision } from "./decisions";
import {
  assessDecisionBridge,
  buildCellContext,
  buildFieldDetail,
  buildFieldSummaries,
  buildRecordDetail,
  buildRecordSummaries,
  GROUPABLE_DISTINCT_LIMIT
} from "./field-view";
import { runRecoveryReview } from "./review";
import { BELLINGHAM_PROCUREWARE } from "../profiles";
import type { SourceProfile } from "./adapter-types";

const FIXED_NOW = "2026-08-12T00:00:00.000Z";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

function getAnalysis() {
  return runAnalysis({
    baselineData: referenceData,
    latestData: candidateData,
    baselineFileName: "bellingham-reference.json",
    latestFileName: "bellingham-candidate.json",
    analysisKey: "field-view-test",
    config: {
      collectionPath: "Export",
      identityFields: ["ProjectCode"],
      ignoredFields: [],
      profileId: BELLINGHAM_PROCUREWARE.id
    }
  });
}

function getReview() {
  return runRecoveryReview(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE, {
    generatedAt: FIXED_NOW,
    sourceRun: "bellingham-candidate.json",
    referenceRun: "bellingham-reference.json"
  });
}

// Shared across tests: both are deterministic for fixed inputs.
const analysis = getAnalysis();
const review = getReview();
const profile = BELLINGHAM_PROCUREWARE;

describe("assessDecisionBridge", () => {
  it("accepts the real pairing", () => {
    expect(assessDecisionBridge(analysis, review, profile)).toEqual({ available: true, reason: null });
  });

  it("refuses without a review, naming the reason", () => {
    const verdict = assessDecisionBridge(analysis, null, profile);
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toContain("No recovery review");
  });

  it("refuses a stale profile version", () => {
    const stale: SourceProfile = { ...profile, version: profile.version + 1 };
    const verdict = assessDecisionBridge(analysis, review, stale);
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toContain("version");
  });

  it("refuses when the resolved policy hash differs, even at the same version", () => {
    // A local override changes policy content without touching the repo
    // version; the version check alone would wave it through.
    const stampedReview = { ...review, policyHash: "aaaaaaaaaaaaaaaa" };
    const differentPolicy = { ...profile, policyHash: "bbbbbbbbbbbbbbbb" };
    const verdict = assessDecisionBridge(analysis, stampedReview, differentPolicy);
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toContain("different resolved policy");

    const samePolicy = { ...profile, policyHash: "aaaaaaaaaaaaaaaa" };
    expect(assessDecisionBridge(analysis, stampedReview, samePolicy).available).toBe(true);

    // Unstamped on either side (pure-engine runs) keeps the old behavior.
    expect(assessDecisionBridge(analysis, review, profile).available).toBe(true);
  });

  it("refuses when the analysis read a different collection than the profile governs", () => {
    const divergent = {
      ...analysis,
      metadata: { ...analysis.metadata, collectionPath: "SomethingElse" }
    };
    const verdict = assessDecisionBridge(divergent, review, profile);
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toContain("SomethingElse");
  });

  it("refuses when an identity field was ignored, which breaks the record bridge", () => {
    const broken = {
      ...analysis,
      metadata: { ...analysis.metadata, ignoredFields: ["BidURL"] }
    };
    const verdict = assessDecisionBridge(broken, review, profile);
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toContain("BidURL");
  });
});

describe("buildFieldDetail on the real Bellingham pair", () => {
  it("covers every record, not just the ones with findings", () => {
    const detail = buildFieldDetail(analysis, "DueDate", review, profile);
    // 499 matched + 1 candidate-only + 1 reference-only.
    expect(detail.cells).toHaveLength(501);
  });

  it("reproduces the documented DueDate evidence: 499 eligible, volatility unmeasurable", () => {
    const detail = buildFieldDetail(analysis, "DueDate", review, profile);
    expect(detail.evidence.eligibleCount).toBe(499);
    expect(detail.evidence.conflictCount).toBe(0);
    expect(detail.evidence.comparablePairCount).toBe(0);
    expect(detail.evidence.volatilityUnmeasurable).toBe(true);
  });

  it("reproduces the measured BidStatus distribution: 488 Awarded, 7 Cancelled, 5 Open", () => {
    const detail = buildFieldDetail(analysis, "BidStatus", review, profile);
    expect(detail.distribution.groups.slice(0, 3)).toEqual([
      { value: "Awarded", count: 488 },
      { value: "Cancelled", count: 7 },
      { value: "Open for Bidding", count: 5 }
    ]);
    expect(detail.distribution.groupable).toBe(true);
  });

  it("surfaces ContactEmail's case variants as distinct values", () => {
    const detail = buildFieldDetail(analysis, "ContactEmail", review, profile);
    const values = detail.distribution.groups.map((group) => group.value);
    expect(values).toContain("bids@cob.org");
    expect(values).toContain("BIDS@COB.ORG");
    expect(values).toContain("purchasing@cob.org");
    expect(detail.distribution.distinctCount).toBe(4);
  });

  it("marks a high-cardinality field as not groupable and reports the lower bound", () => {
    const detail = buildFieldDetail(analysis, "DueDate", review, profile);
    // 391 distinct values, tracked up to the limit only.
    expect(detail.distribution.groupable).toBe(false);
    expect(detail.distribution.distinctIsLowerBound).toBe(true);
    expect(detail.distribution.distinctCount).toBeGreaterThan(GROUPABLE_DISTINCT_LIMIT);
  });

  it("agrees with classifyCells on the lane of every cell both produce", () => {
    const findingCells = new Map(
      classifyCells(review, profile).map((cell) => [cellId(cell.recordKey, cell.field), cell])
    );
    const fields = ["DueDate", "Title", "ContactEmail", "BidType", "BidStatus", "Description", "BidDocuments"];

    let compared = 0;
    for (const field of fields) {
      const detail = buildFieldDetail(analysis, field, review, profile);
      for (const cell of detail.cells) {
        if (cell.decisionRecordKey === null || cell.lane === null) continue;
        const counterpart = findingCells.get(cellId(cell.decisionRecordKey, field));
        if (!counterpart) continue;
        compared += 1;
        expect(cell.lane, `${field} / ${cell.recordKey}`).toBe(counterpart.lane);
        expect(cell.candidateValue).toEqual(counterpart.candidateValue);
        expect(cell.referenceValue).toEqual(counterpart.referenceValue);
      }
    }
    // The overlap must be substantial or this test proves nothing.
    expect(compared).toBeGreaterThan(1500);
  });

  it("classifies the auto lane from provenance: Title cells recovery backfilled are auto", () => {
    const detail = buildFieldDetail(analysis, "Title", review, profile);
    const lanes = new Map<string, number>();
    for (const cell of detail.cells) {
      if (cell.lane) lanes.set(cell.lane, (lanes.get(cell.lane) ?? 0) + 1);
    }
    // Title is profile-approved; recovery backfilled the 499 blank matched cells.
    expect(lanes.get("auto")).toBe(499);
  });

  it("produces decidable classifications createDecision would accept", () => {
    const detail = buildFieldDetail(analysis, "DueDate", review, profile);
    const reviewCells = detail.cells.filter((cell) => cell.lane === "review");
    expect(reviewCells.length).toBe(499);
    for (const cell of reviewCells.slice(0, 3)) {
      expect(cell.classification).not.toBeNull();
      expect(cell.classification!.lane).toBe("review");
      expect(cell.classification!.recordKey).toBe(cell.decisionRecordKey);
    }
  });

  it("handles added and removed records without throwing, with stated situations", () => {
    const detail = buildFieldDetail(analysis, "Title", review, profile);
    const situations = new Set(detail.cells.map((cell) => cell.situation));
    expect(situations.has("record_added")).toBe(true);
    expect(situations.has("record_removed")).toBe(true);
  });

  it("still visualizes when no review exists, with decisions refused and the reason stated", () => {
    const detail = buildFieldDetail(analysis, "DueDate", null, null);
    expect(detail.cells).toHaveLength(501);
    expect(detail.cells[0]!.lane).toBeNull();
    expect(detail.decisionsUnavailableReason).toContain("No recovery review");
    // Values are still fully present for visualization.
    expect(detail.evidence.eligibleCount).toBe(499);
  });
});

describe("cells that must never be decidable", () => {
  it("offers no decision on an excluded field, even though the analysis diffs it", () => {
    // Created is excluded by the profile; QA never compares it, but the raw
    // analysis sees its values change on every record. A decidable lane here
    // would let recovery act where the profile forbids it to look.
    const detail = buildFieldDetail(analysis, "Created", review, profile);
    expect(detail.cells.some((cell) => cell.lane !== null)).toBe(false);
    expect(detail.cells.some((cell) => cell.laneReason.includes("Excluded from comparison"))).toBe(true);
    expect(detail.policy!.excluded).toBe(true);
  });

  it("offers no decision when the analysis and review paired different reference rows", () => {
    // Two records that swap ProjectCodes between runs: the analysis (keyed on
    // ProjectCode) pairs each candidate with the OTHER record's reference row,
    // while the review (keyed on AgentID+BidURL) pairs them correctly.
    const reference = [
      { AgentID: "1", BidURL: "https://x.test/a", ProjectCode: "P-1", Title: "Alpha" },
      { AgentID: "1", BidURL: "https://x.test/b", ProjectCode: "P-2", Title: "Beta" }
    ];
    const candidate = [
      { AgentID: "1", BidURL: "https://x.test/a", ProjectCode: "P-2", Title: "" },
      { AgentID: "1", BidURL: "https://x.test/b", ProjectCode: "P-1", Title: "" }
    ];
    const swappedAnalysis = runAnalysis({
      baselineData: { Export: reference },
      latestData: { Export: candidate },
      baselineFileName: "ref.json",
      latestFileName: "cand.json",
      analysisKey: "swap-test",
      config: { collectionPath: "Export", identityFields: ["ProjectCode"], ignoredFields: [], profileId: profile.id }
    });
    const swappedReview = runRecoveryReview(reference, candidate, profile, {
      generatedAt: FIXED_NOW,
      sourceRun: "cand.json",
      referenceRun: "ref.json"
    });

    const detail = buildFieldDetail(swappedAnalysis, "Title", swappedReview, profile);
    const disputed = detail.cells.filter((cell) => cell.laneReason.includes("disputed pairing"));
    expect(disputed.length).toBeGreaterThan(0);
    for (const cell of disputed) {
      expect(cell.lane).toBeNull();
      expect(cell.classification).toBeNull();
    }
  });
});

describe("cells beyond the QA exemplar cap stay decidable", () => {
  it("classifies one review cell per record on a 600-record wiped field", () => {
    // 600 records exceeds SYSTEMIC_EXEMPLAR_CAP (500); findings sample, we must not.
    const reference = Array.from({ length: 600 }, (_, index) => ({
      AgentID: "1431",
      BidURL: `https://example.test/bid/${index}`,
      ProjectCode: `P-${index}`,
      Title: `Project ${index}`,
      DueDate: `1/${(index % 27) + 1}/2026`
    }));
    const candidate = reference.map((record) => ({ ...record, DueDate: "" }));

    const bigAnalysis = runAnalysis({
      baselineData: { Export: reference },
      latestData: { Export: candidate },
      baselineFileName: "ref.json",
      latestFileName: "cand.json",
      analysisKey: "cap-test",
      config: {
        collectionPath: "Export",
        identityFields: ["ProjectCode"],
        ignoredFields: [],
        profileId: profile.id
      }
    });
    const bigReview = runRecoveryReview(reference, candidate, profile, {
      generatedAt: FIXED_NOW,
      sourceRun: "cand.json",
      referenceRun: "ref.json"
    });

    // The capped source really is capped…
    const findingCells = classifyCells(bigReview, profile).filter((cell) => cell.field === "DueDate");
    expect(findingCells.length).toBeLessThanOrEqual(500);

    // …and the per-field classifier is not.
    const detail = buildFieldDetail(bigAnalysis, "DueDate", bigReview, profile);
    const decidable = detail.cells.filter((cell) => cell.lane === "review" && cell.classification !== null);
    expect(decidable).toHaveLength(600);
  });
});

describe("buildFieldSummaries", () => {
  const summaries = buildFieldSummaries(analysis, review, profile);
  const byField = new Map(summaries.map((summary) => [summary.field, summary]));

  it("produces one row per analyzed field with fill rates from fieldStats", () => {
    expect(summaries).toHaveLength(analysis.fieldStats.length);
    const dueDate = byField.get("DueDate")!;
    const stat = analysis.fieldStats.find((entry) => entry.field === "DueDate")!;
    expect(dueDate.baselineFillRate).toBe(stat.baselinePresentRate);
    expect(dueDate.latestFillRate).toBe(stat.latestPresentRate);
  });

  it("counts review and auto cells consistently with the detail view", () => {
    const dueDate = byField.get("DueDate")!;
    expect(dueDate.cells.review).toBe(499);
    const title = byField.get("Title")!;
    expect(title.cells.auto).toBe(499);
  });

  it("labels the policy classes the profile declares", () => {
    expect(byField.get("Title")!.policy!.safeBackfill).toBe(true);
    expect(byField.get("DueDate")!.policy!.dateSensitive).toBe(true);
    expect(byField.get("DueDate")!.policy!.safeBackfill).toBe(false);
    expect(byField.get("Created")!.policy!.excluded).toBe(true);
    expect(byField.get("DueDate")!.policy!.description).toContain("Rule-6");
  });

  it("degrades without a review: fill rates present, lane counts zero, no policy", () => {
    const degraded = buildFieldSummaries(analysis, null, null);
    const dueDate = degraded.find((summary) => summary.field === "DueDate")!;
    expect(dueDate.baselineFillRate).toBeGreaterThan(0.9);
    expect(dueDate.cells.review).toBe(0);
    expect(dueDate.policy).toBeNull();
  });
});

describe("the record transpose", () => {
  const ctx = buildCellContext(analysis, review, profile);

  it("produces identical cells to buildFieldDetail for the same (record, field)", () => {
    // The property that keeps the two axes honest: same classifier, same
    // values, whichever way you slice.
    const fields = ["DueDate", "Title", "ContactEmail", "Description", "BidDocuments", "Created"];
    const detailsByField = new Map(fields.map((field) => [field, buildFieldDetail(analysis, field, review, profile, ctx)]));

    let compared = 0;
    for (const recordId of Object.keys(analysis.recordsById).slice(0, 50)) {
      const recordDetail = buildRecordDetail(analysis, recordId, review, profile, ctx)!;
      for (const field of fields) {
        const fromRecord = recordDetail.cells.find((cell) => cell.field === field)!;
        const fromField = detailsByField.get(field)!.cells.find((cell) => cell.recordId === recordId)!;
        expect(fromRecord.lane, `${recordId}/${field}`).toBe(fromField.lane);
        expect(fromRecord.laneReason).toBe(fromField.laneReason);
        expect(fromRecord.situation).toBe(fromField.situation);
        expect(fromRecord.candidateValue).toEqual(fromField.candidateValue);
        expect(fromRecord.referenceValue).toEqual(fromField.referenceValue);
        compared += 1;
      }
    }
    expect(compared).toBe(300);
  });

  it("covers every analyzed field for one record, decision lanes matching the workload", () => {
    // A typical wiped record: 4 review cells (the rule-6 fields) and the
    // auto-backfilled ones.
    const summaries = buildRecordSummaries(analysis, review, profile, ctx);
    const typical = summaries.find((summary) => summary.cells.review === 4 && summary.cells.auto >= 2)!;
    expect(typical).toBeDefined();

    const detail = buildRecordDetail(analysis, typical.recordId, review, profile, ctx)!;
    expect(detail.cells).toHaveLength(analysis.fieldStats.length);
    expect(detail.cells.filter((cell) => cell.lane === "review")).toHaveLength(4);
    expect(detail.exclusion).toBeNull();
    // Every decidable cell names its field on the classification createDecision gets.
    for (const cell of detail.cells) {
      if (cell.classification) expect(cell.classification.field).toBe(cell.field);
    }
  });

  it("summary lane totals reconcile with the field-first summaries", () => {
    const recordTotals = buildRecordSummaries(analysis, review, profile, ctx).reduce(
      (total, summary) => total + summary.cells.review + summary.cells.auto,
      0
    );
    const fieldTotals = buildFieldSummaries(analysis, review, profile, ctx).reduce(
      (total, summary) => total + summary.cells.review + summary.cells.auto,
      0
    );
    expect(recordTotals).toBe(fieldTotals);
  });

  it("keeps candidate-only records decidable-free but included (default keep policy)", () => {
    // With candidateOnlyPolicy "keep", the candidate-only record IS in the
    // recovery output — no exclusion warning, but also nothing to decide
    // (there is no reference).
    const summaries = buildRecordSummaries(analysis, review, profile, ctx);
    const candidateOnly = summaries.find((summary) => summary.status === "added")!;
    const detail = buildRecordDetail(analysis, candidateOnly.recordId, review, profile, ctx)!;
    expect(detail.exclusion).toBeNull();
    expect(detail.cells.every((cell) => cell.lane === null)).toBe(true);
  });

  it("flags a record that is absent from the recovery output", () => {
    // The reference-only record (dropped by the candidate run) never enters
    // recovered; a decision on it could not reach the artifact, and the model
    // must say so before the user decides, not after.
    const summaries = buildRecordSummaries(analysis, review, profile, ctx);
    const referenceOnly = summaries.find((summary) => summary.status === "removed")!;
    const detail = buildRecordDetail(analysis, referenceOnly.recordId, review, profile, ctx)!;
    expect(detail.exclusion).not.toBeNull();
  });

  it("returns null for an unknown record id", () => {
    expect(buildRecordDetail(analysis, "no-such-id", review, profile, ctx)).toBeNull();
  });
});

describe("manual value entry", () => {
  const ctx = buildCellContext(analysis, review, profile);
  const target = buildRecordSummaries(analysis, review, profile, ctx).find(
    (summary) => summary.cells.review === 4
  )!;
  const detail = buildRecordDetail(analysis, target.recordId, review, profile, ctx)!;

  it("offers typing on every field of a decidable record except profile-excluded ones", () => {
    const editable = detail.cells.filter((cell) => cell.manualClassification !== null);
    const locked = detail.cells.filter((cell) => cell.manualClassification === null);

    // 45 fields, 2 of them excluded by the profile (Created, Refreshed).
    expect(editable).toHaveLength(analysis.fieldStats.length - 2);
    expect(locked.map((cell) => cell.field).sort()).toEqual(["Created", "Refreshed"]);
  });

  it("covers fields that are blank in both files, which have no lane at all", () => {
    // ContractValue is empty in 100% of both runs: nothing to accept, but a
    // reviewer who knows the number can still enter it.
    const contractValue = detail.cells.find((cell) => cell.field === "ContractValue")!;
    expect(contractValue.classification).toBeNull();
    expect(contractValue.manualClassification).not.toBeNull();
    expect(contractValue.situation).toBe("unchanged");
  });

  it("records a typed value on a cell with no reference, and refuses to accept one", () => {
    const contractValue = detail.cells.find((cell) => cell.field === "ContractValue")!;
    const cell = contractValue.manualClassification!;
    const decisionContext = { review, profile, timestamp: FIXED_NOW, sequence: 0 };

    const typed = createDecision(
      { recordKey: cell.recordKey, field: cell.field, action: "use_custom", customValue: "48250.00", reason: "from the award letter" },
      cell,
      decisionContext
    );
    expect(typed.outputValue).toBe("48250.00");
    expect(typed.actor).toBe("user");

    // There is still nothing to copy, so accepting is refused as before.
    expect(() =>
      createDecision(
        { recordKey: cell.recordKey, field: cell.field, action: "backfill", reason: "no" },
        cell,
        decisionContext
      )
    ).toThrow(/no reference value/);
  });

  it("never offers typing on a record the decisions cannot be attributed to", () => {
    const removed = buildRecordSummaries(analysis, review, profile, ctx).find(
      (summary) => summary.status === "removed"
    )!;
    const removedDetail = buildRecordDetail(analysis, removed.recordId, review, profile, ctx)!;
    expect(removedDetail.cells.every((cell) => cell.manualClassification === null)).toBe(true);
  });
});
