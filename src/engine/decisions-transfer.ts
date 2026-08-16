/**
 * Decision-log transfer: hand a half-finished review to a colleague.
 *
 * Decisions live in one browser's IndexedDB; the export is a JSON file, the
 * import appends its rows to the local log. Import is deliberately narrow —
 * it is allowed only when the file verifiably describes THE SAME review: same
 * profile at the same version and policy hash, and the same input files by
 * SHA-256. Anything else is refused with the specific mismatch, because a
 * decision made against different data or a different policy is not evidence
 * here (AGENTS.md rule 7: the audit trail must never conflate contexts).
 *
 * Imported rows keep their exported id, timestamp, actor, and reason —
 * provenance is preserved, not re-stamped — but are re-sequenced to continue
 * after the local log, so for a cell decided on both sides the imported
 * reviewer's decision lands later and wins, visibly, as a revision.
 */
import { buildFileName, type ExportArtifact, type InputFileHash } from "./export";
import { orderDecisionLog, type DecisionAction, type RecoveryDecision } from "./decisions";
import type { RecoveryReview } from "./review";

export type DecisionTransferContext = {
  profileId: string;
  profileVersion: number;
  policyHash: string | null;
  overrideRevision: number;
  generatedAt: string;
  sourceRun: string | null;
  referenceRun: string | null;
  inputHashes: InputFileHash[];
};

export type DecisionTransfer = {
  formatVersion: 1;
  exportedAt: string;
  context: DecisionTransferContext;
  decisions: RecoveryDecision[];
};

export function buildDecisionTransfer(
  review: RecoveryReview,
  log: RecoveryDecision[],
  exportedAt: string
): DecisionTransfer {
  return {
    formatVersion: 1,
    exportedAt,
    context: {
      profileId: review.profileId,
      profileVersion: review.profileVersion,
      policyHash: review.policyHash,
      overrideRevision: review.overrideRevision,
      generatedAt: review.generatedAt,
      sourceRun: review.sourceRun,
      referenceRun: review.referenceRun,
      inputHashes: review.inputHashes
    },
    decisions: orderDecisionLog(log)
  };
}

export function buildDecisionTransferArtifact(
  review: RecoveryReview,
  log: RecoveryDecision[],
  exportedAt: string
): ExportArtifact {
  return {
    kind: "decisions",
    fileName: buildFileName("decisions", review.profileId, review.generatedAt),
    contentType: "application/json",
    content: JSON.stringify(buildDecisionTransfer(review, log, exportedAt), null, 2)
  };
}

// ---------------------------------------------------------------------------
// Validation — structural, unknown keys are errors (a misspelled key must
// fail, not silently vanish), mirroring src/profiles/validate.ts.
// ---------------------------------------------------------------------------

const TRANSFER_KEYS = new Set(["formatVersion", "exportedAt", "context", "decisions"]);
const CONTEXT_KEYS = new Set([
  "profileId",
  "profileVersion",
  "policyHash",
  "overrideRevision",
  "generatedAt",
  "sourceRun",
  "referenceRun",
  "inputHashes"
]);
const DECISION_ACTIONS: DecisionAction[] = ["backfill", "keep_candidate", "use_custom"];

type ValidationResult = { ok: true; value: DecisionTransfer } | { ok: false; problems: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateDecisionTransfer(parsed: unknown): ValidationResult {
  const problems: string[] = [];
  if (!isRecord(parsed)) {
    return { ok: false, problems: ["Not a decision-transfer object."] };
  }
  for (const key of Object.keys(parsed)) {
    if (!TRANSFER_KEYS.has(key)) problems.push(`Unknown key "${key}".`);
  }
  if (parsed.formatVersion !== 1) {
    problems.push(`formatVersion must be 1, got ${JSON.stringify(parsed.formatVersion)}.`);
  }
  if (typeof parsed.exportedAt !== "string") problems.push("exportedAt must be a string.");

  const context = parsed.context;
  if (!isRecord(context)) {
    problems.push("context must be an object.");
  } else {
    for (const key of Object.keys(context)) {
      if (!CONTEXT_KEYS.has(key)) problems.push(`Unknown context key "${key}".`);
    }
    if (typeof context.profileId !== "string") problems.push("context.profileId must be a string.");
    if (typeof context.profileVersion !== "number") problems.push("context.profileVersion must be a number.");
    if (context.policyHash !== null && typeof context.policyHash !== "string")
      problems.push("context.policyHash must be a string or null.");
    if (typeof context.generatedAt !== "string") problems.push("context.generatedAt must be a string.");
    if (!Array.isArray(context.inputHashes)) problems.push("context.inputHashes must be an array.");
  }

  if (!Array.isArray(parsed.decisions)) {
    problems.push("decisions must be an array.");
  } else {
    parsed.decisions.forEach((row, index) => {
      if (!isRecord(row)) {
        problems.push(`decisions[${index}] is not an object.`);
        return;
      }
      for (const field of ["id", "recordKey", "field", "reason", "timestamp"] as const) {
        if (typeof row[field] !== "string" || row[field] === "")
          problems.push(`decisions[${index}].${field} must be a non-empty string.`);
      }
      if (!DECISION_ACTIONS.includes(row.action as DecisionAction))
        problems.push(`decisions[${index}].action must be one of ${DECISION_ACTIONS.join(", ")}.`);
      if (row.actor !== "user" && row.actor !== "auto") problems.push(`decisions[${index}].actor must be "user" or "auto".`);
      if (typeof row.sequence !== "number") problems.push(`decisions[${index}].sequence must be a number.`);
    });
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: parsed as unknown as DecisionTransfer };
}

// ---------------------------------------------------------------------------
// Rebase onto the current review
// ---------------------------------------------------------------------------

export type RebaseResult =
  | { ok: true; decisions: RecoveryDecision[]; skippedExisting: number }
  | { ok: false; problems: string[] };

function hashByRole(hashes: InputFileHash[], role: InputFileHash["role"]): string | null {
  return hashes.find((hash) => hash.role === role)?.sha256 ?? null;
}

/**
 * Check the transfer belongs to this review and re-sequence its rows to
 * continue after the local log. Rows whose id the local log already has are
 * skipped, so re-importing the same file is idempotent.
 */
export function rebaseDecisionTransfer(
  transfer: DecisionTransfer,
  review: RecoveryReview,
  localLog: RecoveryDecision[]
): RebaseResult {
  const problems: string[] = [];
  const { context } = transfer;

  if (context.profileId !== review.profileId) {
    problems.push(`Profile mismatch: file is for "${context.profileId}", this review ran under "${review.profileId}".`);
  }
  if (context.profileVersion !== review.profileVersion) {
    problems.push(`Profile version mismatch: file v${context.profileVersion}, this review v${review.profileVersion}.`);
  }
  if (context.policyHash === null || review.policyHash === null || context.policyHash !== review.policyHash) {
    problems.push(
      `Policy mismatch: file policy ${context.policyHash ?? "unstamped"}, this review ${review.policyHash ?? "unstamped"}. ` +
        "Decisions transfer only between identical resolved policies."
    );
  }
  for (const role of ["candidate", "reference"] as const) {
    const theirs = hashByRole(context.inputHashes, role);
    const ours = hashByRole(review.inputHashes, role);
    if (theirs === null || ours === null) {
      problems.push(`The ${role} file's SHA-256 is unavailable on ${theirs === null ? "the exported" : "this"} side, so the inputs cannot be verified as identical.`);
    } else if (theirs !== ours) {
      problems.push(`The ${role} file differs: exported ${theirs.slice(0, 12)}…, this review ${ours.slice(0, 12)}….`);
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  const existingIds = new Set(localLog.map((decision) => decision.id));
  const fresh = orderDecisionLog(transfer.decisions).filter((decision) => !existingIds.has(decision.id));
  const skippedExisting = transfer.decisions.length - fresh.length;
  const nextSequence = localLog.reduce((max, decision) => Math.max(max, decision.sequence), -1) + 1;

  return {
    ok: true,
    decisions: fresh.map((decision, index) => ({ ...decision, sequence: nextSequence + index })),
    skippedExisting
  };
}
