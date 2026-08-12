import { describe, expect, it } from "vitest";
import { runRecoveryReview } from "./review";
import { matchRecords } from "./matchRecords";
import { BELLINGHAM_PROCUREWARE } from "../profiles";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const FIXED_NOW = "2026-08-10T00:00:00.000Z";

const run = () =>
  runRecoveryReview(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE, {
    generatedAt: FIXED_NOW,
    sourceRun: "candidate.json",
    referenceRun: "reference.json"
  });

describe("runRecoveryReview", () => {
  const review = run();

  it("returns every stage of the pipeline", () => {
    expect(review.match.candidateCount).toBe(500);
    expect(review.qa.counts.total).toBeGreaterThan(0);
    expect(review.recovery.summary.recoveredCount).toBe(500);
    expect(review.dedupe.summary.participantCount).toBe(500);
  });

  it("carries one provenance envelope across every stage", () => {
    expect(review.profileId).toBe(BELLINGHAM_PROCUREWARE.id);
    expect(review.profileVersion).toBe(BELLINGHAM_PROCUREWARE.version);
    expect(review.generatedAt).toBe(FIXED_NOW);
    expect(review.qa.generatedAt).toBe(FIXED_NOW);
    expect(review.recovery.generatedAt).toBe(FIXED_NOW);
    expect(review.dedupe.generatedAt).toBe(FIXED_NOW);
  });

  it("threads the run names through to the audit trail", () => {
    expect(review.sourceRun).toBe("candidate.json");
    expect(review.recovery.sourceRun).toBe("candidate.json");
    expect(review.recovery.provenance[0]!.referenceRun).toBe("reference.json");
  });

  it("reuses one match report rather than matching twice", () => {
    // QA must see the same pairing recovery acted on, or the findings describe a
    // different run than the artifact does.
    expect(review.qa.matchReport).toBe(review.match);
  });

  it("agrees with running the stages by hand", () => {
    const standalone = matchRecords(referenceRecords, candidateRecords, BELLINGHAM_PROCUREWARE);
    expect(review.match.counts).toEqual(standalone.counts);
    expect(review.match.matchRate).toBe(standalone.matchRate);
  });

  it("is deterministic for identical inputs", () => {
    expect(JSON.stringify(run().recovery.summary)).toBe(JSON.stringify(review.recovery.summary));
  });

  it("defaults input hashes to empty rather than inventing them", () => {
    expect(review.inputHashes).toEqual([]);
  });

  it("dedupes after recovery, so the artifact it describes is the recovered one", () => {
    expect(review.dedupe.summary.participantCount).toBe(
      review.recovery.summary.recoveredCount + review.recovery.summary.excludedCount
    );
  });
});
