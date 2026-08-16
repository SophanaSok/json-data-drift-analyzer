import { describe, expect, it } from "vitest";
import { createDecision, type RecoveryDecision } from "./decisions";
import {
  buildDecisionTransfer,
  buildDecisionTransferArtifact,
  rebaseDecisionTransfer,
  validateDecisionTransfer,
  type DecisionTransfer
} from "./decisions-transfer";
import { runRecoveryReview } from "./review";
import { BELLINGHAM_PROCUREWARE } from "../profiles";
import { resolveEffectiveProfile } from "../profiles/resolve";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";

const FIXED_NOW = "2026-08-15T00:00:00.000Z";
const referenceRecords = (referenceData as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as { Export: Array<Record<string, unknown>> }).Export;

// Resolved (policy-stamped) profile: the transfer gate compares policy hashes,
// and an unstamped review must refuse imports rather than match vacuously.
const resolvedProfile = resolveEffectiveProfile(BELLINGHAM_PROCUREWARE, null).profile;

function getReview(inputHashes = defaultHashes()) {
  return runRecoveryReview(referenceRecords, candidateRecords, resolvedProfile, {
    generatedAt: FIXED_NOW,
    sourceRun: "bellingham-candidate.json",
    referenceRun: "bellingham-reference.json",
    inputHashes
  });
}

function defaultHashes() {
  return [
    { fileName: "bellingham-candidate.json", role: "candidate" as const, sha256: "c".repeat(64), unavailableReason: null },
    { fileName: "bellingham-reference.json", role: "reference" as const, sha256: "r".repeat(64), unavailableReason: null }
  ];
}

const review = getReview();

function decide(sequence: number, field = "DueDate", recordKey = "1B-2019"): RecoveryDecision {
  return createDecision(
    { recordKey, field, action: "backfill", reason: `decision ${sequence}` },
    {
      recordKey,
      field,
      lane: "review",
      reason: "test",
      candidateValue: "",
      referenceValue: "1/31/2019 11:00 AM",
      candidateIsBlank: true,
      profilePermitsField: false
    },
    { review, profile: resolvedProfile, timestamp: FIXED_NOW, sequence }
  );
}

describe("decision transfer: build", () => {
  it("captures the review context and orders the log", () => {
    const transfer = buildDecisionTransfer(review, [decide(1), decide(0)], FIXED_NOW);
    expect(transfer.formatVersion).toBe(1);
    expect(transfer.context.profileId).toBe("bellingham-procureware");
    expect(transfer.context.policyHash).toBe(review.policyHash);
    expect(transfer.context.inputHashes).toHaveLength(2);
    expect(transfer.decisions.map((decision) => decision.sequence)).toEqual([0, 1]);
  });

  it("names the artifact after the profile and run", () => {
    const artifact = buildDecisionTransferArtifact(review, [decide(0)], FIXED_NOW);
    expect(artifact.kind).toBe("decisions");
    expect(artifact.fileName).toBe("bellingham-procureware-decisions-2026-08-15T00-00-00-000Z.json");
    const roundTripped = validateDecisionTransfer(JSON.parse(artifact.content));
    expect(roundTripped.ok).toBe(true);
  });
});

describe("decision transfer: validation", () => {
  const valid = () => JSON.parse(JSON.stringify(buildDecisionTransfer(review, [decide(0)], FIXED_NOW))) as Record<string, unknown>;

  it("accepts its own output", () => {
    expect(validateDecisionTransfer(valid()).ok).toBe(true);
  });

  it("refuses unknown keys rather than ignoring them", () => {
    const parsed = valid();
    parsed.extra = true;
    const result = validateDecisionTransfer(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain('Unknown key "extra"');
  });

  it("refuses a wrong format version and malformed rows", () => {
    const parsed = valid();
    parsed.formatVersion = 2;
    (parsed.decisions as Array<Record<string, unknown>>)[0]!.action = "delete_everything";
    const result = validateDecisionTransfer(parsed);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.join(" ")).toContain("formatVersion must be 1");
      expect(result.problems.join(" ")).toContain("action must be one of");
    }
  });

  it("refuses non-objects outright", () => {
    expect(validateDecisionTransfer("[]").ok).toBe(false);
    expect(validateDecisionTransfer(null).ok).toBe(false);
  });
});

describe("decision transfer: rebase", () => {
  const transferOf = (log: RecoveryDecision[]): DecisionTransfer => buildDecisionTransfer(review, log, FIXED_NOW);

  it("appends after the local log and preserves provenance", () => {
    const local = [decide(0)];
    const imported = transferOf([decide(0, "PublishedDate"), decide(1, "AwardDate")]);
    const result = rebaseDecisionTransfer(imported, review, local);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decisions.map((decision) => decision.sequence)).toEqual([1, 2]);
      expect(result.decisions[0]!.reason).toBe("decision 0");
      expect(result.decisions[0]!.timestamp).toBe(FIXED_NOW);
      expect(result.skippedExisting).toBe(0);
    }
  });

  it("skips rows the local log already has, so re-import is idempotent", () => {
    const shared = decide(0);
    const result = rebaseDecisionTransfer(transferOf([shared, decide(1, "AwardDate")]), review, [shared]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decisions).toHaveLength(1);
      expect(result.skippedExisting).toBe(1);
    }
  });

  it("refuses a policy-hash mismatch with the specific reason", () => {
    const foreign = transferOf([decide(0)]);
    foreign.context.policyHash = "somebody-elses-policy";
    const result = rebaseDecisionTransfer(foreign, review, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("Policy mismatch");
  });

  it("refuses when the input files differ or cannot be verified", () => {
    const differentFile = transferOf([decide(0)]);
    differentFile.context.inputHashes = [
      { fileName: "other.json", role: "candidate", sha256: "x".repeat(64), unavailableReason: null },
      { fileName: "bellingham-reference.json", role: "reference", sha256: "r".repeat(64), unavailableReason: null }
    ];
    const differing = rebaseDecisionTransfer(differentFile, review, []);
    expect(differing.ok).toBe(false);
    if (!differing.ok) expect(differing.problems.join(" ")).toContain("candidate file differs");

    const unverifiable = transferOf([decide(0)]);
    unverifiable.context.inputHashes = [
      { fileName: "c.json", role: "candidate", sha256: null, unavailableReason: "insecure context" },
      { fileName: "r.json", role: "reference", sha256: "r".repeat(64), unavailableReason: null }
    ];
    const result = rebaseDecisionTransfer(unverifiable, review, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("cannot be verified");
  });
});
