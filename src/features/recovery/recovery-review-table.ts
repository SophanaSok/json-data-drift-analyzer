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
