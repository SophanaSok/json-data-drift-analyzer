/**
 * Recovery engine.
 *
 * Produces a NEW artifact from a candidate export, optionally backfilled from a
 * matched reference export. It never writes to its inputs (AGENTS.md rule 2): every
 * output record is a deep clone, so the raw candidate and reference objects are
 * untouched and no caller can mutate them through a result.
 *
 * What the engine may do is decided entirely by the source profile:
 * - a field is backfillable only when listed in `safeBackfillFields` (rule 4);
 * - a field listed in `dateSensitiveFields` is refused unless that same field is
 *   explicitly listed in `safeBackfillFields`, which is the per-source approval
 *   rule 6 demands, and the approval is recorded in the audit trail;
 * - a non-blank candidate value is never overwritten automatically (rule 3);
 * - only `matched_primary` and `matched_fallback` pairings are usable — ambiguous or
 *   invalid identity never yields a backfill (rules 4, 5).
 *
 * No source-specific field name appears in this file.
 */

import { isBackfillEligibleField } from "./source-loader";
import { isEmpty } from "./empty";
import { buildIdentityKey } from "./normalize";
import {
  buildRecordProvenance,
  createProvenanceEntry,
  type ProvenanceEntry,
  type ProvenanceEnvelope,
  type RecordProvenance
} from "./provenance";
import type { Finding } from "./findings";
import type { MatchReport, MatchResult } from "./matchRecords";
import type { SourceProfile } from "./adapter-types";

/** A value a person chose, overriding whatever either export held. */
export type ManualOverride = {
  recordKey: string;
  field: string;
  value: unknown;
  /** Required: a manual override with no stated reason is not auditable. */
  reason: string;
};

export type RecoveryOptions = {
  /** ISO-8601 timestamp. Injectable so identical inputs produce identical output. */
  generatedAt?: string;
  sourceRun?: string;
  referenceRun?: string;
  /** Human decisions to apply. These may overwrite non-blank values; rule 3 binds automation, not people. */
  manualOverrides?: ManualOverride[];
};

export type ExclusionReason =
  | "hard_required_field_missing"
  | "invalid_identity"
  | "ambiguous_identity"
  | "candidate_only_policy";

export type RecoveredRecord = {
  recordKey: string;
  candidateIndex: number;
  referenceIndex: number | null;
  matchStatus: MatchResult["status"];
  /** A new object. Never a reference to an input record. */
  record: Record<string, unknown>;
  /** Fields whose value did not come from the candidate run. */
  backfilledFields: string[];
  overriddenFields: string[];
  containsReferenceDerivedValues: boolean;
};

export type ExcludedRecord = {
  recordKey: string | null;
  candidateIndex: number | null;
  referenceIndex: number | null;
  reason: ExclusionReason;
  detail: string;
  /** Ids of QA findings that justified the exclusion, when any applied. */
  findingIds: string[];
  /** Fields still unpopulated after recovery, for hard_required_field_missing. */
  offendingFields: string[];
};

export type CandidateOnlyRecord = {
  recordKey: string | null;
  candidateIndex: number;
  policy: "keep" | "exclude";
};

export type RecoverySummary = {
  candidateCount: number;
  referenceCount: number;
  recoveredCount: number;
  excludedCount: number;
  candidateOnlyCount: number;
  backfilledFieldCount: number;
  overriddenFieldCount: number;
  recordsWithBackfill: number;
  excludedByReason: Record<ExclusionReason, number>;
  /** Fields the profile permitted, after the rule 6 gate. */
  backfillableFields: string[];
  /** Fields refused because rule 6 requires explicit approval they do not have. */
  dateSensitiveFieldsWithheld: string[];
};

export type RecoveryResult = {
  profileId: string;
  profileVersion: number;
  generatedAt: string;
  sourceRun: string | null;
  referenceRun: string | null;
  matchingKey: string[];
  /**
   * True when any output record contains a reference-derived value. A consumer must
   * not present this artifact as the unmodified product of the candidate run.
   */
  containsReferenceDerivedValues: boolean;
  recovered: RecoveredRecord[];
  excluded: ExcludedRecord[];
  candidateOnly: CandidateOnlyRecord[];
  provenance: ProvenanceEntry[];
  summary: RecoverySummary;
};

const USABLE_MATCH_STATUSES = new Set<MatchResult["status"]>(["matched_primary", "matched_fallback"]);

const ZERO_EXCLUSIONS: Record<ExclusionReason, number> = {
  hard_required_field_missing: 0,
  invalid_identity: 0,
  ambiguous_identity: 0,
  candidate_only_policy: 0
};

/** Deep copy so the artifact shares no structure with the inputs (rule 2). */
function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
  return typeof structuredClone === "function"
    ? structuredClone(record)
    : (JSON.parse(JSON.stringify(record)) as Record<string, unknown>);
}

/**
 * Fields the profile permits for automatic backfill, after applying the rule 6 gate.
 *
 * A date-sensitive field passes only when it is also explicitly listed in
 * safeBackfillFields — that listing IS the per-source approval rule 6 requires.
 */
export function resolveBackfillableFields(profile: SourceProfile): {
  allowed: string[];
  withheld: string[];
  rule6Approved: string[];
} {
  const dateSensitive = new Set(profile.dateSensitiveFields ?? []);
  const excluded = new Set(profile.excludedFields);

  const allowed: string[] = [];
  const rule6Approved: string[] = [];

  for (const field of profile.safeBackfillFields) {
    if (excluded.has(field)) continue;
    allowed.push(field);
    if (dateSensitive.has(field)) rule6Approved.push(field);
  }

  const withheld = [...dateSensitive].filter((field) => !allowed.includes(field)).sort();

  return { allowed, withheld, rule6Approved };
}

function findingsForRecord(findings: Finding[], recordKey: string | null): Finding[] {
  if (recordKey === null) return [];
  return findings.filter((finding) => finding.recordKey === recordKey);
}

export function runRecovery(
  candidateRecords: Array<Record<string, unknown>>,
  referenceRecords: Array<Record<string, unknown>>,
  profile: SourceProfile,
  matchReport: MatchReport,
  findings: Finding[],
  options: RecoveryOptions = {}
): RecoveryResult {
  const envelope: ProvenanceEnvelope = {
    profileId: profile.id,
    profileVersion: profile.version,
    matchingKey: profile.primaryKey,
    sourceRun: options.sourceRun ?? null,
    referenceRun: options.referenceRun ?? null,
    timestamp: options.generatedAt ?? new Date().toISOString()
  };

  const { allowed, withheld, rule6Approved } = resolveBackfillableFields(profile);
  const backfillable = new Set(allowed);
  const rule6ApprovedSet = new Set(rule6Approved);
  const candidateOnlyPolicy = profile.candidateOnlyPolicy ?? "keep";

  const provenance: ProvenanceEntry[] = [];
  const recovered: RecoveredRecord[] = [];
  const excluded: ExcludedRecord[] = [];
  const candidateOnly: CandidateOnlyRecord[] = [];

  const overridesByRecord = new Map<string, ManualOverride[]>();
  for (const override of options.manualOverrides ?? []) {
    const bucket = overridesByRecord.get(override.recordKey);
    if (bucket) bucket.push(override);
    else overridesByRecord.set(override.recordKey, [override]);
  }

  // Results are already in a deterministic order: candidates by index, then unmatched
  // references by index. Iterating them keeps the artifact order deterministic too.
  for (const result of matchReport.results) {
    // Reference-side-only rows describe records absent from the candidate. A recovered
    // artifact is a candidate artifact; reinstating them would invent scraped data.
    if (result.candidateIndex === null) {
      continue;
    }

    const candidateIndex = result.candidateIndex;
    const recordKey = result.candidateKey ?? buildIdentityKey(candidateRecords[candidateIndex], profile.primaryKey).key;
    const relatedFindings = findingsForRecord(findings, recordKey);

    if (result.status === "invalid_identity") {
      excluded.push({
        recordKey,
        candidateIndex,
        referenceIndex: null,
        reason: "invalid_identity",
        detail: `Record cannot be keyed on ${profile.primaryKey.join(", ")}; it cannot be matched or deduplicated.`,
        findingIds: relatedFindings.map((finding) => finding.id),
        offendingFields: [
          ...(result.invalidIdentity?.missingFields ?? []),
          ...(result.invalidIdentity?.blankFields ?? [])
        ]
      });
      continue;
    }

    if (result.status === "ambiguous_primary" || result.status === "ambiguous_fallback") {
      excluded.push({
        recordKey,
        candidateIndex,
        referenceIndex: null,
        reason: "ambiguous_identity",
        detail: `Record matched ambiguously (${result.status}); no reference value may be applied to it.`,
        findingIds: relatedFindings.map((finding) => finding.id),
        offendingFields: []
      });
      continue;
    }

    if (result.status === "candidate_only") {
      candidateOnly.push({ recordKey, candidateIndex, policy: candidateOnlyPolicy });
      if (candidateOnlyPolicy === "exclude") {
        excluded.push({
          recordKey,
          candidateIndex,
          referenceIndex: null,
          reason: "candidate_only_policy",
          detail: "Profile policy excludes candidate-only records from the recovered artifact.",
          findingIds: relatedFindings.map((finding) => finding.id),
          offendingFields: []
        });
        continue;
      }
    }

    const usable = USABLE_MATCH_STATUSES.has(result.status);
    const reference = usable && result.referenceIndex !== null ? referenceRecords[result.referenceIndex] : null;

    const output = cloneRecord(candidateRecords[candidateIndex]);
    const backfilledFields: string[] = [];
    const overriddenFields: string[] = [];
    const key = recordKey ?? `candidate:${candidateIndex}`;

    // ---- Automatic backfill -------------------------------------------------
    if (reference !== null) {
      // Sorted so the provenance log order does not depend on key insertion order.
      for (const field of [...backfillable].sort()) {
        if (!(field in reference)) continue;

        // Rule 4: the candidate value must be null, absent, empty, or whitespace-only.
        if (!isBackfillEligibleField(output, field)) continue;

        const referenceValue = reference[field];
        // Nothing to copy: an unpopulated reference value is not a recovery.
        if (isEmpty(referenceValue)) continue;

        const originalValue = field in output ? output[field] : null;
        output[field] = referenceValue;
        backfilledFields.push(field);

        provenance.push(
          createProvenanceEntry(envelope, {
            recordKey: key,
            field,
            source: "reference_backfill",
            originalValue,
            outputValue: referenceValue,
            reason: rule6ApprovedSet.has(field)
              ? "Candidate value blank; field explicitly approved for backfill including rule 6 date-sensitive approval."
              : "Candidate value blank; field listed in profile safeBackfillFields with exactly one reference match.",
            ruleId: rule6ApprovedSet.has(field)
              ? `${profile.id}@${profile.version}:safeBackfillFields+rule6`
              : `${profile.id}@${profile.version}:safeBackfillFields`,
            actor: "auto",
            candidateIndex,
            referenceIndex: result.referenceIndex,
            matchStatus: result.status
          })
        );
      }
    }

    // ---- Manual overrides ---------------------------------------------------
    // A person may overwrite a non-blank value; rule 3 constrains automation.
    for (const override of overridesByRecord.get(key) ?? []) {
      const originalValue = override.field in output ? output[override.field] : null;
      output[override.field] = override.value;
      overriddenFields.push(override.field);

      provenance.push(
        createProvenanceEntry(envelope, {
          recordKey: key,
          field: override.field,
          source: "manual_override",
          originalValue,
          outputValue: override.value,
          reason: override.reason,
          ruleId: `${profile.id}@${profile.version}:manual_override`,
          actor: "user",
          candidateIndex,
          referenceIndex: result.referenceIndex,
          matchStatus: result.status
        })
      );
    }

    // ---- Rule 6 of the brief: hard-required exclusion, applied AFTER recovery --
    const stillMissing = profile.hardRequiredFields.filter(
      (field) => !(field in output) || isEmpty(output[field])
    );

    if (stillMissing.length > 0) {
      excluded.push({
        recordKey,
        candidateIndex,
        referenceIndex: result.referenceIndex,
        reason: "hard_required_field_missing",
        detail: `Still unpopulated after recovery: ${stillMissing.join(", ")}.`,
        findingIds: relatedFindings
          .filter((finding) => finding.category === "required_field_missing")
          .map((finding) => finding.id),
        offendingFields: stillMissing
      });
      continue;
    }

    recovered.push({
      recordKey: key,
      candidateIndex,
      referenceIndex: result.referenceIndex,
      matchStatus: result.status,
      record: output,
      backfilledFields,
      overriddenFields,
      containsReferenceDerivedValues: backfilledFields.length > 0
    });
  }

  const excludedByReason = { ...ZERO_EXCLUSIONS };
  for (const record of excluded) {
    excludedByReason[record.reason] += 1;
  }

  const backfilledFieldCount = recovered.reduce((total, record) => total + record.backfilledFields.length, 0);
  const overriddenFieldCount = recovered.reduce((total, record) => total + record.overriddenFields.length, 0);

  return {
    profileId: profile.id,
    profileVersion: profile.version,
    generatedAt: envelope.timestamp,
    sourceRun: envelope.sourceRun,
    referenceRun: envelope.referenceRun,
    matchingKey: profile.primaryKey,
    containsReferenceDerivedValues: recovered.some((record) => record.containsReferenceDerivedValues),
    recovered,
    excluded,
    candidateOnly,
    provenance,
    summary: {
      candidateCount: candidateRecords.length,
      referenceCount: referenceRecords.length,
      recoveredCount: recovered.length,
      excludedCount: excluded.length,
      candidateOnlyCount: candidateOnly.length,
      backfilledFieldCount,
      overriddenFieldCount,
      recordsWithBackfill: recovered.filter((record) => record.backfilledFields.length > 0).length,
      excludedByReason,
      backfillableFields: allowed,
      dateSensitiveFieldsWithheld: withheld
    }
  };
}

/** Full field-level provenance for one recovered record, for audit display. */
export function auditRecoveredRecord(
  result: RecoveryResult,
  recordKey: string
): RecordProvenance | null {
  const record = result.recovered.find((entry) => entry.recordKey === recordKey);
  if (!record) return null;
  return buildRecordProvenance(recordKey, record.record, result.provenance);
}
