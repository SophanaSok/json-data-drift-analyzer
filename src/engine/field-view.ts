import { backfilledCellIds, cellId, describeLane, type CellClassification, type DecisionLane } from "./decisions";
import { baselineSnapshot } from "./diff";
import { isBlankStrict } from "./empty";
import { buildIdentityKey } from "./normalize";
import type { SourceProfile } from "./adapter-types";
import type { RecoveryReview } from "./review";
import type { AnalysisResult, DiffRecord } from "./types";

/**
 * Field-first view models: one field at a time, every record's candidate and
 * reference value side by side, with the same decision lanes the review queue
 * uses.
 *
 * Lanes here are classified directly from the analysis records plus the
 * profile — NOT from `qa.findings`, which caps systemic per-record findings at
 * an exemplar sample (see SYSTEMIC_EXEMPLAR_CAP in qa.ts). Deriving from
 * findings would silently make cells beyond the cap undecidable. Classifying
 * one selected field at a time keeps at most one field's cells in memory, which
 * is what makes removing that ceiling safe.
 *
 * Vocabulary note: the analysis calls the two files "baseline" and "latest";
 * recovery calls the same files "reference" and "candidate". This module maps
 * baseline→reference and latest→candidate, matching how the worker feeds both
 * pipelines from the same uploads.
 */

/** How a cell relates across the two files, before any policy is applied. */
export type CellSituation =
  | "unchanged" // both sides equal (or both blank) — nothing to decide
  | "candidate_blank" // reference populated, candidate blank — the backfill case
  | "conflict" // both populated and different
  | "reference_blank" // candidate populated, reference blank or absent — nothing to recover from
  | "record_added" // record exists only in the candidate file
  | "record_removed"; // record exists only in the reference file

export type FieldCell = {
  /**
   * The field this cell belongs to. Ambient in the field view; load-bearing in
   * the record view, where every cell is a different field — and not
   * recoverable from `classification`, which is null for non-decidable cells.
   */
  field: string;
  /** Analysis-side id (JSON identity key over the comparison's identityFields). */
  recordId: string;
  /** Human-readable label shown in tables. */
  recordKey: string;
  /** Review-side key (profile primaryKey), used for decisions; null when unbuildable. */
  decisionRecordKey: string | null;
  candidateValue: unknown;
  referenceValue: unknown;
  situation: CellSituation;
  /**
   * Decision lane, present only when a decision bridge is available. Agrees
   * with `classifyCells` for every cell both produce; additionally covers
   * unchanged and reference-blank cells (as "ineligible") and cells beyond the
   * QA exemplar cap.
   */
  lane: DecisionLane | null;
  /** Human explanation of the lane (or of why no decision is offered). */
  laneReason: string;
  /** A CellClassification accepted by createDecision, when the cell is decidable. */
  classification: CellClassification | null;
};

export type FieldValueGroup = {
  /** Display form of the reference value. */
  value: string;
  count: number;
};

export type FieldDistribution = {
  /** Distinct reference-side values, most frequent first. */
  groups: FieldValueGroup[];
  distinctCount: number;
  /** True when distinctCount stopped counting at the tracking limit. */
  distinctIsLowerBound: boolean;
  /** Below this many distinct values the UI may offer group-by-value review. */
  groupable: boolean;
  populatedReferenceCount: number;
};

export type FieldEvidence = {
  /** Cells where the reference is populated and the candidate is blank. */
  eligibleCount: number;
  /** Cells where both sides are populated and differ. */
  conflictCount: number;
  /** Records with a populated value on BOTH sides — the volatility base. */
  comparablePairCount: number;
  /** True when comparablePairCount is zero: no cross-run stability can be measured. */
  volatilityUnmeasurable: boolean;
  baselineFillRate: number;
  latestFillRate: number;
};

export type FieldPolicy = {
  safeBackfill: boolean;
  manualReview: boolean;
  excluded: boolean;
  dateSensitive: boolean;
  /** One-line human description of what the profile says about this field. */
  description: string;
};

export type FieldSummary = {
  field: string;
  baselineFillRate: number;
  latestFillRate: number;
  populationChange: number;
  severity: DiffRecord["severity"];
  changedRecordCount: number;
  distinctReferenceValues: number;
  distinctIsLowerBound: boolean;
  policy: FieldPolicy | null;
  /** Lane counts across all records; zeros when no decision bridge exists. */
  cells: { auto: number; review: number; ineligible: number; unchanged: number };
};

export type FieldDetail = {
  field: string;
  cells: FieldCell[];
  distribution: FieldDistribution;
  evidence: FieldEvidence;
  policy: FieldPolicy | null;
  /** Null when decisions are available; otherwise the reason they are not. */
  decisionsUnavailableReason: string | null;
};

/**
 * Whether the analysis and the review describe the same rows the same way —
 * the precondition for keying decisions off analysis records.
 *
 * The analysis pairs records by the comparison's identityFields; decisions and
 * provenance key by the profile's primaryKey. Bridging is done per record via
 * the profile key, which is only sound when both pipelines read the same
 * collection and the key fields survived normalization. When any check fails,
 * the view still visualizes — it just refuses to offer decisions, with the
 * reason stated. A forensics tool may not quietly pair the wrong rows.
 */
export function assessDecisionBridge(
  analysis: AnalysisResult,
  review: RecoveryReview | null,
  profile: SourceProfile | null
): { available: boolean; reason: string | null } {
  if (!review || !profile) {
    return { available: false, reason: "No recovery review was produced for this run, so there is nothing to decide against." };
  }
  if (review.profileId !== profile.id) {
    return { available: false, reason: `The review was produced under profile "${review.profileId}", not "${profile.id}".` };
  }
  if (review.profileVersion !== profile.version) {
    return {
      available: false,
      reason: `The review was produced under profile version ${review.profileVersion}, but the current profile is version ${profile.version}. Re-run the analysis to decide under the current policy.`
    };
  }
  if (analysis.metadata.collectionPath !== profile.collectionPath) {
    return {
      available: false,
      reason: `The analysis read records from "${analysis.metadata.collectionPath}" but the profile governs "${profile.collectionPath}"; the two views may not describe the same rows.`
    };
  }
  const ignored = new Set(analysis.metadata.ignoredFields);
  const brokenKeyField = profile.primaryKey.find((field) => ignored.has(field));
  if (brokenKeyField) {
    return {
      available: false,
      reason: `Identity field "${brokenKeyField}" was ignored in this comparison, so records cannot be matched to the review's decisions.`
    };
  }
  return { available: true, reason: null };
}

/** Candidate-side body of an analysis record, if the record has one. */
function candidateBody(record: DiffRecord): Record<string, unknown> | undefined {
  return record.status === "removed" ? undefined : record.latest;
}

/** Reference-side value without cloning the record (baselineSnapshot clones). */
function referenceValueOf(record: DiffRecord, field: string): unknown {
  if (record.status === "added") return undefined;
  const change = record.changedFields.find((entry) => entry.path === field || entry.path.startsWith(`${field}.`));
  if (change) {
    // For a nested change the top-level baseline value is not recoverable
    // cheaply; the Bellingham data is flat, and a nested field falls back to
    // the latest side, which equals the baseline for the unchanged part.
    return change.path === field ? change.baselineValue : record.latest?.[field];
  }
  if (record.status === "removed") return record.baseline?.[field];
  return record.latest?.[field];
}

function situationOf(record: DiffRecord, candidate: unknown, reference: unknown): CellSituation {
  if (record.status === "added") return "record_added";
  if (record.status === "removed") return "record_removed";
  const candidateBlank = isBlankStrict(candidate);
  const referenceBlank = isBlankStrict(reference);
  if (candidateBlank && referenceBlank) return "unchanged";
  if (candidateBlank) return "candidate_blank";
  if (referenceBlank) return "reference_blank";
  return candidate === reference ? "unchanged" : "conflict";
}

export function describeFieldPolicy(profile: SourceProfile, field: string): FieldPolicy {
  const safeBackfill = profile.safeBackfillFields.includes(field);
  const manualReview = profile.manualReviewFields.includes(field);
  const excluded = profile.excludedFields.includes(field);
  const dateSensitive = (profile.dateSensitiveFields ?? []).includes(field);

  let description: string;
  if (excluded) {
    description = "Excluded from comparison by the profile; never compared, never recovered.";
  } else if (safeBackfill && dateSensitive) {
    description = "Approved for automatic backfill, with the rule-6 date-sensitive approval on record.";
  } else if (safeBackfill) {
    description = "Approved for automatic backfill when the candidate value is blank.";
  } else if (dateSensitive) {
    description = "Rule-6 date-sensitive: requires explicit per-source approval before automatic backfill. Review only.";
  } else if (manualReview) {
    description = "Manual review only: the profile does not approve automatic backfill.";
  } else {
    description = "No profile ruling; not approved for automatic backfill.";
  }
  return { safeBackfill, manualReview, excluded, dateSensitive, description };
}

/**
 * Profile-side record keys that appear more than once in the analysis. A
 * decision keyed on a duplicated key would ambiguously cover several rows, so
 * those rows are shown but not decidable.
 */
function duplicatedDecisionKeys(records: DiffRecord[], profile: SourceProfile): Set<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const record of records) {
    const body = candidateBody(record) ?? record.baseline;
    const key = body ? buildIdentityKey(body, profile.primaryKey).key : null;
    if (key === null) continue;
    if (seen.has(key)) duplicated.add(key);
    seen.add(key);
  }
  return duplicated;
}

const DISTINCT_TRACK_LIMIT = 64;
/** At or below this many distinct values, group-by-value review is offered. */
export const GROUPABLE_DISTINCT_LIMIT = 25;

/**
 * The review's authoritative pairing: candidate profile-key → the profile-key
 * of the reference record recovery actually paired it with. Covers both
 * primary and fallback matches.
 */
function reviewPairings(review: RecoveryReview): Map<string, string> {
  const pairings = new Map<string, string>();
  for (const result of review.match.results) {
    if (
      (result.status === "matched_primary" || result.status === "matched_fallback") &&
      result.candidateKey !== null &&
      result.referenceKey !== null
    ) {
      pairings.set(result.candidateKey, result.referenceKey);
    }
  }
  return pairings;
}

/**
 * The analysis paired records by the comparison's identityFields; decisions
 * apply by the profile's primaryKey. For the pairing to be trustworthy for
 * decisions, the reference row the analysis paired must be the same row the
 * review paired — checked by rebuilding the reference side's own profile-key
 * from the analysis baseline values and comparing it with the review's
 * pairing. A mismatch means the two pipelines paired different rows, and a
 * decision recorded here could apply the wrong record's value.
 */
function pairingVerified(
  record: DiffRecord,
  profile: SourceProfile,
  candidateKey: string,
  pairings: Map<string, string>
): boolean {
  if (record.status !== "changed" && record.status !== "unchanged") return true;
  const expectedReferenceKey = pairings.get(candidateKey);
  if (expectedReferenceKey === undefined) return false;
  const referenceKeyBody: Record<string, unknown> = {};
  for (const field of profile.primaryKey) {
    referenceKeyBody[field] = referenceValueOf(record, field);
  }
  return buildIdentityKey(referenceKeyBody, profile.primaryKey).key === expectedReferenceKey;
}

export function formatCellValue(value: unknown): string {
  if (value === undefined) return "(absent)";
  if (value === null) return "(null)";
  if (typeof value === "string") return value.trim().length === 0 ? "(blank)" : value;
  return JSON.stringify(value);
}

/**
 * The field-independent setup both view axes need. O(records + provenance +
 * matchResults) to build — the dominant cost of any classification call — so
 * the UI must memoize one per (analysis, review, profile) and pass it in;
 * rebuilding it per selected record would make every click O(records).
 */
export type CellContext = {
  bridge: { available: boolean; reason: string | null };
  review: RecoveryReview | null;
  profile: SourceProfile | null;
  backfilled: Set<string>;
  duplicated: Set<string>;
  pairings: Map<string, string>;
  permitted: Set<string>;
  excludedFields: Set<string>;
};

export function buildCellContext(
  analysis: AnalysisResult,
  review: RecoveryReview | null,
  profile: SourceProfile | null
): CellContext {
  const bridge = assessDecisionBridge(analysis, review, profile);
  const records = Object.values(analysis.recordsById);
  return {
    bridge,
    review,
    profile,
    backfilled: bridge.available && review ? backfilledCellIds(review) : new Set<string>(),
    duplicated: bridge.available && profile ? duplicatedDecisionKeys(records, profile) : new Set<string>(),
    pairings: bridge.available && review ? reviewPairings(review) : new Map<string, string>(),
    permitted: profile ? new Set(profile.safeBackfillFields) : new Set<string>(),
    excludedFields: profile ? new Set(profile.excludedFields) : new Set<string>()
  };
}

/** Per-record facts shared by all of that record's cells. */
export type RecordCellContext = {
  record: DiffRecord;
  decisionRecordKey: string | null;
  duplicateKey: boolean;
  pairingOk: boolean;
};

export function prepareRecordCellContext(ctx: CellContext, record: DiffRecord): RecordCellContext {
  if (!ctx.bridge.available || !ctx.profile) {
    return { record, decisionRecordKey: null, duplicateKey: false, pairingOk: true };
  }
  const body = candidateBody(record) ?? record.baseline;
  const decisionRecordKey = body ? buildIdentityKey(body, ctx.profile.primaryKey).key : null;
  return {
    record,
    decisionRecordKey,
    duplicateKey: decisionRecordKey !== null && ctx.duplicated.has(decisionRecordKey),
    pairingOk:
      decisionRecordKey === null ? true : pairingVerified(record, ctx.profile, decisionRecordKey, ctx.pairings)
  };
}

/**
 * One cell, classified. The single home of the lane rules for both view axes —
 * the field view loops this over records, the record view over fields, and a
 * test asserts they can never disagree.
 */
export function classifyCell(
  ctx: CellContext,
  recordCtx: RecordCellContext,
  field: string,
  candidate: unknown,
  reference: unknown
): FieldCell {
  const { record, decisionRecordKey } = recordCtx;
  const situation = situationOf(record, candidate, reference);

  let lane: DecisionLane | null = null;
  let laneReason: string;
  let classification: CellClassification | null = null;

  if (!ctx.bridge.available || !ctx.profile) {
    laneReason = ctx.bridge.reason ?? "Decisions are unavailable for this run.";
  } else if (situation === "record_removed") {
    laneReason = "This record exists only in the reference file; there is no candidate record to write into.";
  } else if (situation === "record_added") {
    laneReason = "This record exists only in the candidate file; there is no reference to recover from.";
  } else if (ctx.excludedFields.has(field)) {
    laneReason = "Excluded from comparison by this profile; recovery may not act on it.";
  } else if (decisionRecordKey === null) {
    laneReason = "This record's identity fields are blank or missing, so no decision can be attributed to it.";
  } else if (recordCtx.duplicateKey) {
    laneReason = "Another record shares this identity key; a decision would ambiguously cover both rows.";
  } else if (!recordCtx.pairingOk) {
    laneReason =
      "The comparison and the recovery review did not pair this record with the same reference row; no decision is offered on a disputed pairing.";
  } else if (situation === "unchanged") {
    laneReason = "Both files agree on this value; there is nothing to decide.";
  } else {
    const candidateIsBlank = isBlankStrict(candidate);
    const profilePermitsField = ctx.permitted.has(field);
    const referenceMissing = reference === undefined || reference === null;
    // The same lane rules as classifyCells, over the same key space.
    lane = referenceMissing
      ? "ineligible"
      : ctx.backfilled.has(cellId(decisionRecordKey, field))
        ? "auto"
        : "review";
    laneReason = describeLane(lane, {
      candidateIsBlank,
      profilePermitsField,
      category: situation === "conflict" ? "field_conflict" : "field_regression"
    });
    classification = {
      recordKey: decisionRecordKey,
      field,
      lane,
      reason: laneReason,
      candidateValue: candidate,
      referenceValue: reference,
      candidateIsBlank,
      profilePermitsField
    };
  }

  return {
    field,
    recordId: record.id,
    recordKey: record.recordKey,
    decisionRecordKey,
    candidateValue: candidate,
    referenceValue: reference,
    situation,
    lane,
    laneReason,
    classification
  };
}

/**
 * Everything the detail panel needs for one field, over every record.
 *
 * O(records) per call; only the selected field's cells are materialized.
 * Memoize per (analysis, field, review, profile) in the UI.
 */
export function buildFieldDetail(
  analysis: AnalysisResult,
  field: string,
  review: RecoveryReview | null,
  profile: SourceProfile | null,
  context?: CellContext
): FieldDetail {
  const ctx = context ?? buildCellContext(analysis, review, profile);
  const records = Object.values(analysis.recordsById);

  const cells: FieldCell[] = [];
  const valueCounts = new Map<string, number>();
  let distinctOverflow = false;
  let eligibleCount = 0;
  let conflictCount = 0;
  let comparablePairCount = 0;

  for (const record of records) {
    const candidate = record.status === "removed" ? undefined : record.latest?.[field];
    const reference = referenceValueOf(record, field);
    const cell = classifyCell(ctx, prepareRecordCellContext(ctx, record), field, candidate, reference);
    cells.push(cell);

    if (cell.situation === "candidate_blank") eligibleCount += 1;
    if (cell.situation === "conflict") conflictCount += 1;
    if (!isBlankStrict(candidate) && !isBlankStrict(reference)) comparablePairCount += 1;

    if (!isBlankStrict(reference)) {
      const display = formatCellValue(reference);
      if (valueCounts.has(display)) {
        valueCounts.set(display, valueCounts.get(display)! + 1);
      } else if (valueCounts.size < DISTINCT_TRACK_LIMIT) {
        valueCounts.set(display, 1);
      } else {
        distinctOverflow = true;
      }
    }
  }


  const groups = [...valueCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const populatedReferenceCount = groups.reduce((total, group) => total + group.count, 0);

  const stat = analysis.fieldStats.find((entry) => entry.field === field);

  return {
    field,
    cells,
    distribution: {
      groups,
      distinctCount: valueCounts.size,
      distinctIsLowerBound: distinctOverflow,
      groupable: !distinctOverflow && valueCounts.size > 0 && valueCounts.size <= GROUPABLE_DISTINCT_LIMIT,
      populatedReferenceCount
    },
    evidence: {
      eligibleCount,
      conflictCount,
      comparablePairCount,
      volatilityUnmeasurable: comparablePairCount === 0,
      baselineFillRate: stat?.baselinePresentRate ?? 0,
      latestFillRate: stat?.latestPresentRate ?? 0
    },
    policy: ctx.profile ? describeFieldPolicy(ctx.profile, field) : null,
    decisionsUnavailableReason: ctx.bridge.reason
  };
}

/**
 * One summary row per field, cheap enough to compute eagerly for all fields.
 *
 * Fill rates, change counts, and severity come straight off the analysis
 * (already computed); the single extra pass counts distinct reference values
 * and lane totals. O(records × fields); memoize per (analysis, review,
 * profile).
 */
export function buildFieldSummaries(
  analysis: AnalysisResult,
  review: RecoveryReview | null,
  profile: SourceProfile | null,
  context?: CellContext
): FieldSummary[] {
  const ctx = context ?? buildCellContext(analysis, review, profile);
  const records = Object.values(analysis.recordsById);

  type Tally = {
    distinct: Set<string>;
    overflow: boolean;
    auto: number;
    review: number;
    ineligible: number;
    unchanged: number;
  };
  const tallies = new Map<string, Tally>();
  for (const stat of analysis.fieldStats) {
    tallies.set(stat.field, { distinct: new Set(), overflow: false, auto: 0, review: 0, ineligible: 0, unchanged: 0 });
  }

  for (const record of records) {
    const recordCtx = prepareRecordCellContext(ctx, record);

    for (const [field, tally] of tallies) {
      const candidate = record.status === "removed" ? undefined : record.latest?.[field];
      const reference = referenceValueOf(record, field);
      const cell = classifyCell(ctx, recordCtx, field, candidate, reference);

      if (!isBlankStrict(reference)) {
        const display = formatCellValue(reference);
        if (tally.distinct.has(display) || tally.distinct.size < DISTINCT_TRACK_LIMIT) {
          tally.distinct.add(display);
        } else {
          tally.overflow = true;
        }
      }

      if (cell.lane === null) {
        tally.unchanged += cell.situation === "unchanged" ? 1 : 0;
      } else {
        tally[cell.lane] += 1;
      }
    }
  }

  return analysis.fieldStats.map((stat) => {
    const tally = tallies.get(stat.field)!;
    return {
      field: stat.field,
      baselineFillRate: stat.baselinePresentRate,
      latestFillRate: stat.latestPresentRate,
      populationChange: stat.populationChange,
      severity: stat.severity,
      changedRecordCount: analysis.indexes.byField[stat.field]?.size ?? 0,
      distinctReferenceValues: tally.distinct.size,
      distinctIsLowerBound: tally.overflow,
      policy: ctx.profile ? describeFieldPolicy(ctx.profile, stat.field) : null,
      cells: { auto: tally.auto, review: tally.review, ineligible: tally.ineligible, unchanged: tally.unchanged }
    };
  });
}

/** One record's row in the record queue. */
export type RecordSummary = {
  recordId: string;
  recordKey: string;
  decisionRecordKey: string | null;
  status: DiffRecord["status"];
  severity: DiffRecord["severity"];
  changedFieldCount: number;
  cells: { auto: number; review: number; ineligible: number; unchanged: number };
  /** Fields in the review lane — with the decision log, exact pending counts. */
  reviewFields: string[];
  /** Fields recovery auto-backfilled (vetoable). */
  autoFields: string[];
};

export type RecordDetailModel = {
  recordId: string;
  recordKey: string;
  decisionRecordKey: string | null;
  status: DiffRecord["status"];
  /** Every analyzed field, in fieldStats order; the UI reorders for display. */
  cells: FieldCell[];
  /** Null when decisions are available; otherwise the reason they are not. */
  decisionsUnavailableReason: string | null;
  /**
   * Whether this record is in the recovery output at all. A decision on an
   * excluded record lands in unappliedOverrides at export — the user must see
   * that before deciding, not after.
   */
  exclusion: { reason: string; detail: string } | null;
};

/**
 * The record-first transpose of buildFieldDetail: one record, every field,
 * through the same classifyCell. O(fields) per call once the context exists.
 *
 * Reference values come from baselineSnapshot — one clone per record is
 * trivial (the field view avoids it only because it runs per record × field),
 * and it handles nested changed paths exactly.
 */
export function buildRecordDetail(
  analysis: AnalysisResult,
  recordId: string,
  review: RecoveryReview | null,
  profile: SourceProfile | null,
  context?: CellContext
): RecordDetailModel | null {
  const record = analysis.recordsById[recordId];
  if (!record) return null;
  const ctx = context ?? buildCellContext(analysis, review, profile);
  const recordCtx = prepareRecordCellContext(ctx, record);
  const baseline = baselineSnapshot(record);

  const cells = analysis.fieldStats.map((stat) => {
    const field = stat.field;
    const candidate = record.status === "removed" ? undefined : record.latest?.[field];
    const reference = record.status === "added" ? undefined : baseline?.[field];
    return classifyCell(ctx, recordCtx, field, candidate, reference);
  });

  let exclusion: RecordDetailModel["exclusion"] = null;
  if (ctx.bridge.available && ctx.review && recordCtx.decisionRecordKey !== null) {
    const recovered = ctx.review.recovery.recovered.some(
      (entry) => entry.recordKey === recordCtx.decisionRecordKey
    );
    if (!recovered) {
      const excluded = ctx.review.recovery.excluded.find(
        (entry) => entry.recordKey === recordCtx.decisionRecordKey
      );
      exclusion = excluded
        ? { reason: excluded.reason, detail: excluded.detail }
        : {
            reason: "not_recovered",
            detail: "This record is not in the recovery output; decisions on it cannot reach the exported artifact."
          };
    }
  }

  return {
    recordId: record.id,
    recordKey: record.recordKey,
    decisionRecordKey: recordCtx.decisionRecordKey,
    status: record.status,
    cells,
    decisionsUnavailableReason: ctx.bridge.reason,
    exclusion
  };
}

/**
 * One summary per record for the queue list, via the same classifier as the
 * detail views. O(records × fields); memoize per (analysis, review, profile).
 */
export function buildRecordSummaries(
  analysis: AnalysisResult,
  review: RecoveryReview | null,
  profile: SourceProfile | null,
  context?: CellContext
): RecordSummary[] {
  const ctx = context ?? buildCellContext(analysis, review, profile);
  const fields = analysis.fieldStats.map((stat) => stat.field);

  return Object.values(analysis.recordsById).map((record) => {
    const recordCtx = prepareRecordCellContext(ctx, record);
    const cells = { auto: 0, review: 0, ineligible: 0, unchanged: 0 };
    const reviewFields: string[] = [];
    const autoFields: string[] = [];
    for (const field of fields) {
      const candidate = record.status === "removed" ? undefined : record.latest?.[field];
      const reference = referenceValueOf(record, field);
      const cell = classifyCell(ctx, recordCtx, field, candidate, reference);
      if (cell.lane === null) {
        cells.unchanged += cell.situation === "unchanged" ? 1 : 0;
      } else {
        cells[cell.lane] += 1;
        if (cell.lane === "review") reviewFields.push(field);
        if (cell.lane === "auto") autoFields.push(field);
      }
    }
    return {
      recordId: record.id,
      recordKey: record.recordKey,
      decisionRecordKey: recordCtx.decisionRecordKey,
      status: record.status,
      severity: record.severity,
      changedFieldCount: record.changedFieldCount,
      cells,
      reviewFields,
      autoFields
    };
  });
}
