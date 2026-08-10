/**
 * Pure view models for the recovery review.
 *
 * Rendering stays in the component; everything that decides what a reviewer is shown
 * lives here so it can be tested without a DOM. Counts are derived from the engine
 * results, never recomputed by hand — a review that disagrees with the artifact it
 * describes would be worse than no review.
 */

import type { RecoveryReview } from "../../engine/review";
import type { ProvenanceSource } from "../../engine/provenance";
import type { Finding, FindingCategory, FindingSeverity, RecommendedAction } from "../../engine/findings";

export type BackfillGroup = {
  field: string;
  /** Records that would receive a value for this field. */
  count: number;
  /** Distinct values being written, capped for display. */
  sampleValues: string[];
  /** How many distinct values exist in total, cap or no cap. */
  distinctValueCount: number;
  examples: Array<{ recordKey: string; candidateIndex: number | null; outputValue: string }>;
};

export type ReviewSummaryTile = {
  id: string;
  label: string;
  value: string;
  /** Extra context shown under the number. */
  detail?: string;
  tone: "neutral" | "good" | "warn" | "bad";
};

const SAMPLE_LIMIT = 5;
const EXAMPLE_LIMIT = 3;

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * What recovery would write, grouped by field.
 *
 * Sorted by count descending so the largest change is first, then by field name for
 * a stable order when counts tie.
 */
export function groupBackfillsByField(review: RecoveryReview): BackfillGroup[] {
  const groups = new Map<string, { values: string[]; examples: BackfillGroup["examples"] }>();

  for (const entry of review.recovery.provenance) {
    if (entry.source !== "reference_backfill") continue;
    const bucket = groups.get(entry.field) ?? { values: [], examples: [] };
    bucket.values.push(asText(entry.outputValue));
    if (bucket.examples.length < EXAMPLE_LIMIT) {
      bucket.examples.push({
        recordKey: entry.recordKey,
        candidateIndex: entry.candidateIndex,
        outputValue: asText(entry.outputValue)
      });
    }
    groups.set(entry.field, bucket);
  }

  return [...groups.entries()]
    .map(([field, bucket]) => {
      const distinct = [...new Set(bucket.values)];
      return {
        field,
        count: bucket.values.length,
        sampleValues: distinct.slice(0, SAMPLE_LIMIT),
        distinctValueCount: distinct.length,
        examples: bucket.examples
      };
    })
    .sort((left, right) =>
      right.count !== left.count ? right.count - left.count : left.field.localeCompare(right.field)
    );
}

/** Fields the profile withheld, so a reviewer can see what was deliberately not done. */
export function withheldFields(review: RecoveryReview): string[] {
  return [...review.recovery.summary.dateSensitiveFieldsWithheld].sort();
}

export function buildSummaryTiles(review: RecoveryReview): ReviewSummaryTile[] {
  const { match, recovery, dedupe, qa } = review;
  const matchPercent = `${(match.matchRate * 100).toFixed(2)}%`;

  return [
    {
      id: "match-rate",
      label: "Match rate",
      value: matchPercent,
      detail: `${match.counts.matched_primary + match.counts.matched_fallback} of ${match.candidateCount} candidate records`,
      tone: match.meetsMinimumMatchRate ? "good" : "bad"
    },
    {
      id: "values-recovered",
      label: "Values recovered",
      value: String(recovery.summary.backfilledFieldCount),
      detail:
        recovery.summary.backfillableFields.length > 0
          ? `across ${recovery.summary.recordsWithBackfill} records`
          : "no field is approved for backfill",
      tone: recovery.summary.backfilledFieldCount > 0 ? "good" : "neutral"
    },
    {
      id: "records-excluded",
      label: "Records excluded",
      value: String(recovery.summary.excludedCount),
      detail: recovery.summary.excludedCount > 0 ? "see exclusions below" : "none",
      tone: recovery.summary.excludedCount > 0 ? "warn" : "good"
    },
    {
      id: "duplicates-removed",
      label: "Duplicates removed",
      value: String(dedupe.summary.removedCount),
      detail: `${dedupe.summary.duplicateGroupCount} duplicate group(s)`,
      tone: dedupe.summary.removedCount > 0 ? "warn" : "good"
    },
    {
      id: "critical-findings",
      label: "Critical findings",
      value: String(qa.counts.bySeverity.critical),
      detail: `${qa.counts.total} findings in total`,
      tone: qa.counts.bySeverity.critical > 0 ? "bad" : "good"
    }
  ];
}

export type ExclusionGroup = {
  reason: string;
  count: number;
  examples: Array<{ recordKey: string | null; candidateIndex: number | null; detail: string }>;
};

export function groupExclusions(review: RecoveryReview): ExclusionGroup[] {
  const groups = new Map<string, ExclusionGroup>();

  for (const record of review.recovery.excluded) {
    const group = groups.get(record.reason) ?? { reason: record.reason, count: 0, examples: [] };
    group.count += 1;
    if (group.examples.length < EXAMPLE_LIMIT) {
      group.examples.push({
        recordKey: record.recordKey,
        candidateIndex: record.candidateIndex,
        detail: record.detail
      });
    }
    groups.set(record.reason, group);
  }

  return [...groups.values()].sort((left, right) => right.count - left.count);
}

export type RecordProvenanceRow = {
  field: string;
  source: ProvenanceSource;
  originalValue: string;
  outputValue: string;
  reason: string;
};

/** Field-level provenance for one recovered record, sorted for a stable read. */
export function provenanceRowsForRecord(review: RecoveryReview, recordKey: string): RecordProvenanceRow[] {
  return review.recovery.provenance
    .filter((entry) => entry.recordKey === recordKey)
    .map((entry) => ({
      field: entry.field,
      source: entry.source,
      originalValue: asText(entry.originalValue),
      outputValue: asText(entry.outputValue),
      reason: entry.reason
    }))
    .sort((left, right) => left.field.localeCompare(right.field));
}

/** Records that would change, for the drill-down list. */
export function changedRecords(review: RecoveryReview): Array<{
  recordKey: string;
  candidateIndex: number;
  changedFieldCount: number;
  fields: string[];
}> {
  return review.recovery.recovered
    .filter((record) => record.backfilledFields.length + record.overriddenFields.length > 0)
    .map((record) => ({
      recordKey: record.recordKey,
      candidateIndex: record.candidateIndex,
      changedFieldCount: record.backfilledFields.length + record.overriddenFields.length,
      fields: [...record.backfilledFields, ...record.overriddenFields].sort()
    }))
    .sort((left, right) =>
      right.changedFieldCount !== left.changedFieldCount
        ? right.changedFieldCount - left.changedFieldCount
        : left.candidateIndex - right.candidateIndex
    );
}

// ---------------------------------------------------------------------------
// Findings explorer
// ---------------------------------------------------------------------------

export type FindingFilter = {
  severity: FindingSeverity | "all";
  category: FindingCategory | "all";
  field: string | "all";
  action: RecommendedAction | "all";
  /** Free text matched against message and record key. */
  search: string;
};

export const DEFAULT_FINDING_FILTER: FindingFilter = {
  severity: "all",
  category: "all",
  field: "all",
  action: "all",
  search: ""
};

export type FindingFilterOptions = {
  severities: FindingSeverity[];
  categories: FindingCategory[];
  fields: string[];
  actions: RecommendedAction[];
};

const SEVERITY_SORT: FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

/**
 * Options actually present in this run, not every value the type allows.
 *
 * A filter offering "critical" on a run with no critical findings invites the user to
 * select it and conclude the data is missing.
 */
export function deriveFilterOptions(findings: Finding[]): FindingFilterOptions {
  const severities = new Set<FindingSeverity>();
  const categories = new Set<FindingCategory>();
  const fields = new Set<string>();
  const actions = new Set<RecommendedAction>();

  for (const finding of findings) {
    severities.add(finding.severity);
    categories.add(finding.category);
    actions.add(finding.recommendedAction);
    if (finding.fieldPath !== null) fields.add(finding.fieldPath);
  }

  return {
    severities: [...severities].sort((left, right) => SEVERITY_SORT.indexOf(left) - SEVERITY_SORT.indexOf(right)),
    categories: [...categories].sort(),
    fields: [...fields].sort(),
    actions: [...actions].sort()
  };
}

/** Every filter is an AND; "all" means the dimension is not constrained. */
export function applyFindingFilters(findings: Finding[], filter: FindingFilter): Finding[] {
  const search = filter.search.trim().toLowerCase();

  return findings.filter((finding) => {
    if (filter.severity !== "all" && finding.severity !== filter.severity) return false;
    if (filter.category !== "all" && finding.category !== filter.category) return false;
    if (filter.action !== "all" && finding.recommendedAction !== filter.action) return false;
    if (filter.field !== "all" && finding.fieldPath !== filter.field) return false;
    if (search.length > 0) {
      const haystack = `${finding.message} ${finding.recordKey ?? ""} ${finding.fieldPath ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

export function isFilterActive(filter: FindingFilter): boolean {
  return (
    filter.severity !== "all" ||
    filter.category !== "all" ||
    filter.field !== "all" ||
    filter.action !== "all" ||
    filter.search.trim().length > 0
  );
}

// ---------------------------------------------------------------------------
// Record inspector
// ---------------------------------------------------------------------------

export type RecordInspectionRow = {
  field: string;
  /** Value in the candidate export, before any recovery. */
  candidateValue: string;
  /**
   * Value in the matched reference export. Null when this run never recorded one —
   * only fields a finding compared have a known reference value, and saying "unknown"
   * is honest where guessing would not be.
   */
  referenceValue: string | null;
  /** Value in the recovered artifact. */
  outputValue: string;
  source: ProvenanceSource;
  changed: boolean;
};

export type RecordInspection = {
  recordKey: string;
  candidateIndex: number;
  referenceIndex: number | null;
  matchStatus: string;
  rows: RecordInspectionRow[];
  changedFieldCount: number;
};

/**
 * Candidate, reference, and output side by side for one recovered record.
 *
 * Reference values come from QA findings, which are the only place this pipeline
 * records both sides of a comparison; fields no finding covered show reference as
 * unknown rather than implying it matched.
 */
export function buildRecordInspection(review: RecoveryReview, recordKey: string): RecordInspection | null {
  const record = review.recovery.recovered.find((entry) => entry.recordKey === recordKey);
  if (!record) return null;

  const provenanceByField = new Map(
    review.recovery.provenance.filter((entry) => entry.recordKey === recordKey).map((entry) => [entry.field, entry])
  );
  const referenceByField = new Map<string, unknown>();
  for (const finding of review.qa.findings) {
    if (finding.recordKey !== recordKey || finding.fieldPath === null) continue;
    if (finding.referenceValue !== undefined) referenceByField.set(finding.fieldPath, finding.referenceValue);
  }

  const rows: RecordInspectionRow[] = Object.keys(record.record)
    .sort()
    .map((field) => {
      const entry = provenanceByField.get(field);
      const outputValue = asText(record.record[field]);
      // Where a value changed, provenance holds what the candidate had before it.
      const candidateValue = entry ? asText(entry.originalValue) : outputValue;
      const reference = referenceByField.has(field) ? asText(referenceByField.get(field)) : null;

      return {
        field,
        candidateValue,
        referenceValue: reference,
        outputValue,
        source: entry?.source ?? "candidate",
        changed: entry !== undefined
      };
    });

  return {
    recordKey,
    candidateIndex: record.candidateIndex,
    referenceIndex: record.referenceIndex,
    matchStatus: record.matchStatus,
    rows,
    changedFieldCount: record.backfilledFields.length + record.overriddenFields.length
  };
}
