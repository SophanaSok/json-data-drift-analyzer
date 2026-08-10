/**
 * Finding vocabulary for the QA engine.
 *
 * A Finding is a report, never an instruction. `recommendedAction` records what the
 * profile permits; it authorizes nothing on its own, and nothing in this module or
 * in qa.ts recovers, merges, mutates, or exports records (AGENTS.md rules 2, 3).
 *
 * Note on severity: this scale is intentionally separate from `Severity` in
 * ./types.ts ("pass" | "info" | "warning" | "high" | "critical"), which the existing
 * diff/quality path uses. The two are not interchangeable.
 */

import type { SourceProfile } from "./adapter-types";

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export type FindingCategory =
  /** A profile-declared hard-required field is absent or unpopulated. */
  | "required_field_missing"
  /** A value failed a validation rule configured for its field. */
  | "field_validation_failure"
  /** Reference held a value, the matched candidate does not. */
  | "field_regression"
  /** Both sides hold different non-blank values. */
  | "field_conflict"
  /** A field present in the reference schema is absent from the candidate schema. */
  | "schema_field_missing"
  /** Two or more records share a configured identity or dedupe key. */
  | "duplicate_identity_key"
  /** Candidate record population differs from the reference. */
  | "record_count_anomaly"
  /** A record could not be matched unambiguously, or could not be keyed at all. */
  | "identity_match_issue";

/**
 * What the profile permits for this finding. Advisory only.
 *
 * - `exclude` — the field or record is out of scope for comparison
 * - `backfill_allowed` — the profile lists the field in safeBackfillFields AND rule 4's
 *   emptiness precondition holds. Still requires the other rule 4 conditions.
 * - `manual_review` — a person must decide
 * - `report_only` — surface it; no action is defined
 */
export type RecommendedAction = "exclude" | "backfill_allowed" | "manual_review" | "report_only";

export type Finding = {
  /** Deterministic across runs for the same input. See `stableFindingId`. */
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  /** Field the finding concerns, or null for record- and dataset-level findings. */
  fieldPath: string | null;
  /** Identity key of the record concerned, or null for dataset-level findings. */
  recordKey: string | null;
  candidateValue: unknown;
  referenceValue: unknown;
  message: string;
  evidence: Record<string, unknown>;
  recommendedAction: RecommendedAction;
};

/**
 * FNV-1a, 32-bit. Not cryptographic — it exists to keep ids short and stable across
 * runs and machines. `hashText` in src/lib/hash.ts is async (SubtleCrypto) and cannot
 * be used from a synchronous pure engine function.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Build a stable, deterministic finding id.
 *
 * The category stays readable in the prefix; the rest is hashed so that long values
 * (URLs used as record keys) do not produce unwieldy ids. Identical inputs always
 * produce the same id, so findings can be deduplicated and referenced across runs.
 *
 * @param discriminator - distinguishes findings that share category, record, and field
 */
export function stableFindingId(
  category: FindingCategory,
  recordKey: string | null,
  fieldPath: string | null,
  discriminator = ""
): string {
  const parts = JSON.stringify([category, recordKey, fieldPath, discriminator]);
  return `${category}:${fnv1a(parts)}`;
}

export type CreateFindingInput = Omit<Finding, "id"> & { discriminator?: string };

export function createFinding(input: CreateFindingInput): Finding {
  const { discriminator, ...finding } = input;
  return {
    id: stableFindingId(finding.category, finding.recordKey, finding.fieldPath, discriminator),
    ...finding
  };
}

/**
 * Resolve what the profile permits for a field, from the profile alone.
 *
 * Precedence is deliberate: `excludedFields` wins over everything, and
 * `backfill_allowed` is only reachable when the caller confirms rule 4's emptiness
 * precondition holds. A field listed in `safeBackfillFields` whose candidate value is
 * NOT blank resolves to manual review, because rule 3 forbids overwriting it
 * automatically regardless of policy.
 */
export function resolveRecommendedAction(
  profile: SourceProfile,
  fieldPath: string | null,
  options: { candidateIsBlank?: boolean } = {}
): RecommendedAction {
  if (fieldPath === null) {
    return "report_only";
  }
  if (profile.excludedFields.includes(fieldPath)) {
    return "exclude";
  }
  if (options.candidateIsBlank === true && profile.safeBackfillFields.includes(fieldPath)) {
    return "backfill_allowed";
  }
  if (profile.manualReviewFields.includes(fieldPath) || profile.safeBackfillFields.includes(fieldPath)) {
    return "manual_review";
  }
  return "report_only";
}

export type FindingCounts = {
  total: number;
  bySeverity: Record<FindingSeverity, number>;
  byCategory: Record<FindingCategory, number>;
};

const ZERO_SEVERITY: Record<FindingSeverity, number> = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0
};

const ZERO_CATEGORY: Record<FindingCategory, number> = {
  required_field_missing: 0,
  field_validation_failure: 0,
  field_regression: 0,
  field_conflict: 0,
  schema_field_missing: 0,
  duplicate_identity_key: 0,
  record_count_anomaly: 0,
  identity_match_issue: 0
};

export function summarizeFindings(findings: Finding[]): FindingCounts {
  const bySeverity = { ...ZERO_SEVERITY };
  const byCategory = { ...ZERO_CATEGORY };

  for (const finding of findings) {
    bySeverity[finding.severity] += 1;
    byCategory[finding.category] += 1;
  }

  return { total: findings.length, bySeverity, byCategory };
}
