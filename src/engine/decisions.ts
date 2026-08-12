/**
 * Append-only decision log.
 *
 * Phase 3 of docs/recovery-workflow.proposed.md. Decisions are recorded, never
 * edited: changing your mind appends a new entry, and the latest one for a cell
 * wins. The history is the audit trail, so overwriting an entry would destroy the
 * very thing rule 7 exists to preserve.
 *
 * The engine's policy still binds automation. A person may do things automation may
 * not — overwrite a non-blank value, accept a value automation withheld — because
 * rules 3, 5, and 6 constrain *automatic* behaviour. Every such decision is recorded
 * with `actor: "user"` and a mandatory reason, so the artifact never hides who acted.
 *
 * What a person may NOT do is decide on a cell that has no reference value to draw
 * from. That is not policy, it is arithmetic, and it is refused.
 *
 * The proposal called the identity field `matchKey`; this uses `recordKey` to match
 * the name every other module in this engine already uses.
 */

import { isBlankStrict } from "./empty";
import type { ManualOverride } from "./recovery";
import type { RecoveryReview } from "./review";
import type { SourceProfile } from "./adapter-types";

export type DecisionAction =
  /** Write the reference value into the artifact. */
  | "backfill"
  /** Leave the candidate value as it is. Recorded so the choice is visible. */
  | "keep_candidate"
  /** Write a value the person supplied, which may match neither export. */
  | "use_custom";

export type DecisionLane =
  /** Policy already permits this; recovery applied it automatically. */
  | "auto"
  /** A person must decide. */
  | "review"
  /** Nothing to decide: there is no reference value to draw from. */
  | "ineligible";

export type CellClassification = {
  recordKey: string;
  field: string;
  lane: DecisionLane;
  /** Why the cell landed in this lane, in words a reviewer can act on. */
  reason: string;
  candidateValue: unknown;
  referenceValue: unknown;
  /** True when rule 4's emptiness precondition holds for the candidate value. */
  candidateIsBlank: boolean;
  /** True when the profile lists this field as automatically backfillable. */
  profilePermitsField: boolean;
};

export type RecoveryDecision = {
  /** Stable id. Deterministic given the cell, action, and timestamp. */
  id: string;
  recordKey: string;
  field: string;
  action: DecisionAction;
  originalValue: unknown;
  outputValue: unknown;
  actor: "auto" | "user";
  reason: string;
  sourceRun: string | null;
  referenceRun: string | null;
  matchingKey: string[];
  profileId: string;
  profileVersion: number;
  timestamp: string;
  /**
   * Position in the append-only log at recording time. Persisted because it is what
   * makes "the latest decision for a cell" reconstructible: timestamps can tie (two
   * clicks in one millisecond, a bulk batch), and a store's iteration order is not
   * append order. Resolution order must come from here, never from storage order.
   */
  sequence: number;
};

export type DecisionInput = {
  recordKey: string;
  field: string;
  action: DecisionAction;
  /** Required for use_custom; ignored otherwise. */
  customValue?: unknown;
  reason: string;
};

// Escaped, not a literal NUL byte: a raw NUL makes this file binary to grep and
// most diff tools, which silently hides matches.
const CELL_SEPARATOR = "\u0000";

/** Cell identity. Uses NUL so a field name containing the separator cannot collide. */
export function cellId(recordKey: string, field: string): string {
  return `${recordKey}${CELL_SEPARATOR}${field}`;
}

/**
 * Classify every cell a reviewer could act on.
 *
 * Cells come from QA findings, the only place this pipeline records both sides of a
 * comparison. A field no finding covered has no reference value on record and so
 * offers a reviewer nothing to decide between.
 */
export function classifyCells(review: RecoveryReview, profile: SourceProfile): CellClassification[] {
  const permitted = new Set(profile.safeBackfillFields);
  const backfilled = new Set(
    review.recovery.provenance
      .filter((entry) => entry.source === "reference_backfill")
      .map((entry) => cellId(entry.recordKey, entry.field))
  );

  const cells: CellClassification[] = [];

  for (const finding of review.qa.findings) {
    if (finding.recordKey === null || finding.fieldPath === null) continue;
    if (finding.category !== "field_regression" && finding.category !== "field_conflict") continue;

    const id = cellId(finding.recordKey, finding.fieldPath);
    const candidateIsBlank = isBlankStrict(finding.candidateValue);
    const profilePermitsField = permitted.has(finding.fieldPath);
    const referenceMissing = finding.referenceValue === undefined || finding.referenceValue === null;

    const lane: DecisionLane = referenceMissing ? "ineligible" : backfilled.has(id) ? "auto" : "review";

    cells.push({
      recordKey: finding.recordKey,
      field: finding.fieldPath,
      lane,
      reason: describeLane(lane, { candidateIsBlank, profilePermitsField, category: finding.category }),
      candidateValue: finding.candidateValue,
      referenceValue: finding.referenceValue,
      candidateIsBlank,
      profilePermitsField
    });
  }

  return cells;
}

export function describeLane(
  lane: DecisionLane,
  context: { candidateIsBlank: boolean; profilePermitsField: boolean; category: string }
): string {
  if (lane === "auto") {
    return "Recovered automatically: the profile permits this field and the candidate value was blank.";
  }
  if (lane === "ineligible") {
    return "No reference value was recorded for this cell, so there is nothing to decide between.";
  }
  if (!context.candidateIsBlank) {
    return context.category === "field_conflict"
      ? "Both sides hold a value and they differ. Automation may not overwrite a populated value; a person must choose."
      : "The candidate value is not blank, so automation may not replace it.";
  }
  return context.profilePermitsField
    ? "The profile permits this field, but recovery did not apply it — check the match status for this record."
    : "The profile does not approve this field for automatic backfill.";
}

/**
 * Deterministic id, unique per entry.
 *
 * The sequence is part of the hash because cell, action, and timestamp alone are not
 * unique: deciding backfill, then keep, then backfill again on one cell would
 * regenerate the first id, and a keyed store would overwrite the earlier row --
 * silently destroying the append-only history this log exists to keep.
 */
function decisionId(input: DecisionInput, timestamp: string, sequence: number): string {
  let hash = 0x811c9dc5;
  const source = JSON.stringify([input.recordKey, input.field, input.action, timestamp, sequence]);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `decision:${hash.toString(16).padStart(8, "0")}`;
}

export type DecisionContext = {
  review: RecoveryReview;
  profile: SourceProfile;
  /** ISO-8601. Injectable so identical inputs produce identical entries. */
  timestamp: string;
  /**
   * Position of this entry in the log. Callers pass the current log length so ids
   * stay unique when the same decision is made, reversed, and made again.
   */
  sequence: number;
};

/**
 * Build a decision entry, refusing anything that cannot be audited or applied.
 *
 * @throws when the reason is blank, the cell is ineligible, or a custom decision
 *   carries no value
 */
export function createDecision(
  input: DecisionInput,
  cell: CellClassification,
  context: DecisionContext
): RecoveryDecision {
  if (input.reason.trim().length === 0) {
    throw new Error(`Decision for ${input.field} has no reason; a reason is required for the audit trail.`);
  }
  if (cell.lane === "ineligible") {
    throw new Error(`Cannot decide on ${input.field}: no reference value was recorded for this cell.`);
  }
  if (input.action === "use_custom" && input.customValue === undefined) {
    throw new Error(`Custom decision for ${input.field} carries no value.`);
  }

  const outputValue =
    input.action === "backfill"
      ? cell.referenceValue
      : input.action === "use_custom"
        ? input.customValue
        : cell.candidateValue;

  return {
    id: decisionId(input, context.timestamp, context.sequence),
    recordKey: input.recordKey,
    field: input.field,
    action: input.action,
    originalValue: cell.candidateValue,
    outputValue,
    // A decision recorded here is always a person's; automation's actions are
    // already recorded in the recovery provenance log.
    actor: "user",
    reason: input.reason.trim(),
    sourceRun: context.review.sourceRun,
    referenceRun: context.review.referenceRun,
    matchingKey: context.profile.primaryKey,
    profileId: context.profile.id,
    profileVersion: context.profile.version,
    timestamp: context.timestamp,
    sequence: context.sequence
  };
}

/** Append, never replace. The previous entry for a cell stays in the history. */
export function appendDecision(log: RecoveryDecision[], decision: RecoveryDecision): RecoveryDecision[] {
  return [...log, decision];
}

/**
 * Reconstruct append order from persisted rows.
 *
 * A keyed store returns rows in ITS order (primary-key order for an IndexedDB index
 * scan), which has nothing to do with the order decisions were made — and
 * `resolveDecisions` is last-entry-wins, so feeding it storage order can silently
 * flip which decision is in force. Sort by the recorded sequence; timestamp and id
 * are tie-breakers only for rows persisted before sequences existed.
 */
export function orderDecisionLog<T extends RecoveryDecision>(rows: T[]): T[] {
  const sequenceOf = (row: T): number => (Number.isFinite(row.sequence) ? row.sequence : -1);
  return [...rows].sort((left, right) => {
    const bySequence = sequenceOf(left) - sequenceOf(right);
    if (bySequence !== 0) return bySequence;
    const byTimestamp = left.timestamp.localeCompare(right.timestamp);
    if (byTimestamp !== 0) return byTimestamp;
    return left.id.localeCompare(right.id);
  });
}

/**
 * The decision in force for each cell: the last one recorded.
 *
 * Earlier entries are deliberately retained in the log. "Backfilled, then reverted"
 * is a different history from "never touched", and only the log shows the difference.
 */
export function resolveDecisions(log: RecoveryDecision[]): Map<string, RecoveryDecision> {
  const resolved = new Map<string, RecoveryDecision>();
  for (const decision of log) {
    resolved.set(cellId(decision.recordKey, decision.field), decision);
  }
  return resolved;
}

/** Every entry recorded for one cell, oldest first. */
export function decisionHistory(log: RecoveryDecision[], recordKey: string, field: string): RecoveryDecision[] {
  const id = cellId(recordKey, field);
  return log.filter((decision) => cellId(decision.recordKey, decision.field) === id);
}

/**
 * Turn decisions in force into overrides recovery can apply.
 *
 * `keep_candidate` produces no override: it records that a person looked and chose
 * to change nothing, which is a decision worth having on record but not an edit.
 */
export function decisionsToOverrides(resolved: Map<string, RecoveryDecision>): ManualOverride[] {
  return [...resolved.values()]
    .filter((decision) => decision.action !== "keep_candidate")
    .sort((left, right) =>
      left.recordKey === right.recordKey
        ? left.field.localeCompare(right.field)
        : left.recordKey.localeCompare(right.recordKey)
    )
    .map((decision) => ({
      recordKey: decision.recordKey,
      field: decision.field,
      value: decision.outputValue,
      reason: decision.reason,
      // Carried onto the provenance entry: the audit records when the person
      // decided, not when the analysis ran.
      timestamp: decision.timestamp
    }));
}

export type DecisionSummary = {
  totalEntries: number;
  cellsDecided: number;
  byAction: Record<DecisionAction, number>;
  /** Cells whose current decision supersedes an earlier one. */
  revisedCells: number;
};

export function summarizeDecisions(log: RecoveryDecision[]): DecisionSummary {
  const resolved = resolveDecisions(log);
  const seen = new Map<string, number>();
  for (const decision of log) {
    const id = cellId(decision.recordKey, decision.field);
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }

  const byAction: Record<DecisionAction, number> = { backfill: 0, keep_candidate: 0, use_custom: 0 };
  for (const decision of resolved.values()) {
    byAction[decision.action] += 1;
  }

  return {
    totalEntries: log.length,
    cellsDecided: resolved.size,
    byAction,
    revisedCells: [...seen.values()].filter((count) => count > 1).length
  };
}

export type LaneCounts = Record<DecisionLane, number>;

export function countLanes(cells: CellClassification[]): LaneCounts {
  const counts: LaneCounts = { auto: 0, review: 0, ineligible: 0 };
  for (const cell of cells) {
    counts[cell.lane] += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Bulk decisions
// ---------------------------------------------------------------------------

export type SkippedCell = {
  recordKey: string;
  field: string;
  reason: string;
};

export type BulkDecisionResult = {
  /** One entry per cell. The log stays per-cell, so provenance is unchanged. */
  decisions: RecoveryDecision[];
  applied: number;
  /** Cells the bulk action refused, each with why. Never silently dropped. */
  skipped: SkippedCell[];
};

export type BulkDecisionInput = {
  /**
   * `use_custom` is deliberately not accepted in bulk. Bulk custom means writing one
   * literal to every cell, which is exactly the modal-value mistake that would
   * rewrite the single outlier record along with the rest. A custom value is a
   * per-cell judgement and stays a per-cell action.
   */
  action: Exclude<DecisionAction, "use_custom">;
  reason: string;
};

export type BulkImpact = {
  /** Cells a bulk action would record decisions for. */
  eligible: number;
  /** Cells with no reference value; always skipped. */
  ineligible: number;
  /** Eligible cells whose candidate value is blank — a backfill fills a gap. */
  fillBlank: number;
  /** Eligible cells holding a value — a backfill OVERWRITES it. */
  overwritePopulated: number;
  /** Distinct eligible fields, sorted. */
  fields: string[];
  /** Rule-6 date-sensitive fields in the batch, each with its cell count, sorted. */
  dateSensitive: Array<{ field: string; count: number }>;
  /**
   * True when a bulk BACKFILL would skip the date-sensitive cells: the batch spans
   * more than one field, so deciding a rule-6 field here would be a side effect of
   * a blanket action rather than a decision about that field.
   */
  dateSensitiveRequiresPerField: boolean;
};

/**
 * What a bulk action over these cells actually covers.
 *
 * A flat count hides that "use reference for all" mixes three different acts:
 * filling blanks, overwriting populated values (the thing rule 3 exists to make
 * deliberate), and deciding rule-6 date/status-sensitive fields. The confirmation
 * step renders this breakdown so the person approves what will happen, not a number.
 */
export function assessBulkImpact(cells: CellClassification[], profile: SourceProfile): BulkImpact {
  const dateSensitiveFields = new Set(profile.dateSensitiveFields ?? []);
  const eligibleCells = cells.filter((cell) => cell.lane !== "ineligible");

  const byField = new Map<string, number>();
  let fillBlank = 0;
  let overwritePopulated = 0;
  for (const cell of eligibleCells) {
    byField.set(cell.field, (byField.get(cell.field) ?? 0) + 1);
    if (cell.candidateIsBlank) fillBlank += 1;
    else overwritePopulated += 1;
  }

  const fields = [...byField.keys()].sort();
  const dateSensitive = fields
    .filter((field) => dateSensitiveFields.has(field))
    .map((field) => ({ field, count: byField.get(field) ?? 0 }));

  return {
    eligible: eligibleCells.length,
    ineligible: cells.length - eligibleCells.length,
    fillBlank,
    overwritePopulated,
    fields,
    dateSensitive,
    dateSensitiveRequiresPerField: dateSensitive.length > 0 && fields.length > 1
  };
}

/**
 * Record the same decision across many cells, one entry each.
 *
 * `backfill` copies each cell's OWN reference value — never a shared or modal value.
 * That distinction is the whole reason bulk is safe here: the action is uniform, the
 * values are not.
 *
 * A bulk BACKFILL over a batch spanning several fields skips any rule-6
 * date-sensitive cells, each with a stated reason: those fields are review-only
 * precisely because each needs a deliberate per-field decision, and a blanket
 * "use reference for all" is not one. Filtering the batch to that single field —
 * naming it — is, and is allowed. `keep_candidate` changes nothing, so it carries
 * no such restriction.
 *
 * @throws when the reason is blank, or a custom action is attempted in bulk
 */
export function createBulkDecisions(
  cells: CellClassification[],
  input: BulkDecisionInput,
  context: DecisionContext
): BulkDecisionResult {
  if (input.reason.trim().length === 0) {
    throw new Error("Bulk decision has no reason; a reason is required for the audit trail.");
  }
  // Defensive: the type forbids this, but a caller crossing a boundary might not be typed.
  if ((input.action as DecisionAction) === "use_custom") {
    throw new Error(
      "A custom value cannot be applied in bulk: it would write one literal to every cell. Decide those individually."
    );
  }

  const impact = assessBulkImpact(cells, context.profile);
  const dateSensitiveFields = new Set(context.profile.dateSensitiveFields ?? []);
  const skipDateSensitive = input.action === "backfill" && impact.dateSensitiveRequiresPerField;

  const decisions: RecoveryDecision[] = [];
  const skipped: SkippedCell[] = [];

  for (const cell of cells) {
    if (cell.lane === "ineligible") {
      skipped.push({
        recordKey: cell.recordKey,
        field: cell.field,
        reason: "No reference value was recorded for this cell."
      });
      continue;
    }

    if (skipDateSensitive && dateSensitiveFields.has(cell.field)) {
      skipped.push({
        recordKey: cell.recordKey,
        field: cell.field,
        reason: `"${cell.field}" is date-sensitive (rule 6); filter the queue to ${cell.field} alone to bulk-decide it.`
      });
      continue;
    }

    decisions.push(
      createDecision(
        { recordKey: cell.recordKey, field: cell.field, action: input.action, reason: input.reason },
        cell,
        // Each entry takes the next position, so a batch cannot collide with itself.
        { ...context, sequence: context.sequence + decisions.length }
      )
    );
  }

  return { decisions, applied: decisions.length, skipped };
}

/** Append many entries at once, preserving their order. */
export function appendDecisions(log: RecoveryDecision[], decisions: RecoveryDecision[]): RecoveryDecision[] {
  return [...log, ...decisions];
}
