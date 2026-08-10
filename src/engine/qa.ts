/**
 * Profile-driven QA engine.
 *
 * Produces structured Findings by comparing a candidate export against a reference
 * export. It reports; it does not act. Nothing here recovers, merges, mutates, or
 * exports records, and no input object is written to (AGENTS.md rules 2, 3).
 * Matching is delegated to matchRecords, which is exact-only (rule 5).
 *
 * Every rule is driven by the source profile. No field name from any specific source
 * appears in this file — which fields are required, excluded, validated, backfillable,
 * or identity-bearing comes entirely from the profile (rule 1).
 */

import { isEmpty, isBlankStrict } from "./empty";
import {
  createFinding,
  resolveRecommendedAction,
  summarizeFindings,
  type Finding,
  type FindingCounts,
  type FindingSeverity
} from "./findings";
import { matchRecords, type MatchReport, type MatchResult } from "./matchRecords";
import { buildIdentityKey } from "./normalize";
import type { FieldValidationRules, SourceProfile } from "./adapter-types";

export type QaOptions = {
  /** Reuse an existing match report instead of recomputing one. */
  matchReport?: MatchReport;
  /** Overrides `profile.validation` when supplied. */
  validation?: FieldValidationRules;
  /** ISO-8601 timestamp for the report envelope. Injectable so runs are reproducible. */
  generatedAt?: string;
  /** Candidate run identifier (file name or run id) — AGENTS.md rule 7. */
  sourceRun?: string;
  /** Reference run identifier — AGENTS.md rule 7. */
  referenceRun?: string;
};

export type QaReport = {
  /** Provenance envelope. Rule 7 requires these on anything derived from the run. */
  profileId: string;
  profileVersion: number;
  generatedAt: string;
  sourceRun: string | null;
  referenceRun: string | null;
  matchingKey: string[];
  candidateCount: number;
  referenceCount: number;
  matchReport: MatchReport;
  findings: Finding[];
  counts: FindingCounts;
};

type ValidationKind = keyof FieldValidationRules;

type ValidationOutcome = { valid: boolean; reason: string };

/**
 * Format checks, deliberately loose.
 *
 * `json` and `url` are objective — the value either parses or it does not. `date` is
 * near-objective. `email` and `phone` are heuristics: this source's own data mixes
 * formats, and a strict pattern would manufacture failures for values the source
 * considers valid. Findings from the heuristic kinds are reported at low severity.
 */
const VALIDATORS: Record<ValidationKind, (value: string) => ValidationOutcome> = {
  jsonFields: (value) => {
    try {
      JSON.parse(value);
      return { valid: true, reason: "" };
    } catch (error) {
      return { valid: false, reason: error instanceof Error ? error.message : "not parseable as JSON" };
    }
  },
  urlFields: (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:"
        ? { valid: true, reason: "" }
        : { valid: false, reason: `scheme "${url.protocol}" is not http or https` };
    } catch {
      return { valid: false, reason: "not an absolute URL" };
    }
  },
  dateFields: (value) =>
    Number.isNaN(Date.parse(value))
      ? { valid: false, reason: "not parseable as a date" }
      : { valid: true, reason: "" },
  emailFields: (value) => {
    const parts = value.split("@");
    const shaped = parts.length === 2 && parts[0].length > 0 && parts[1].includes(".") && !/\s/.test(value);
    return shaped ? { valid: true, reason: "" } : { valid: false, reason: "not shaped like an email address" };
  },
  phoneFields: (value) => {
    const digits = value.replace(/\D/g, "");
    return digits.length === 0
      ? { valid: false, reason: "contains no digits" }
      : { valid: true, reason: "" };
  }
};

const HEURISTIC_KINDS = new Set<ValidationKind>(["emailFields", "phoneFields"]);

/**
 * Canonical serialization used only when a value is not a scalar.
 *
 * Object keys are sorted so insertion order cannot affect the result. Array order IS
 * preserved, because reordering an array is a real change.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
}

/**
 * Value equality for conflict detection.
 *
 * Scalars compare directly, which is both allocation-free and exact — and in this
 * source every value is a string, so that is the only path taken in practice. Values
 * that are objects or arrays fall back to a canonical comparison insensitive to key
 * insertion order, so `{a:1,b:2}` and `{b:2,a:1}` are equal rather than a false
 * conflict. Comparing raw `JSON.stringify` output would report that pair as differing.
 */
export function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  return canonicalize(left) === canonicalize(right);
}

function validationSeverity(kind: ValidationKind, isRequiredField: boolean): FindingSeverity {
  if (HEURISTIC_KINDS.has(kind)) return "low";
  return isRequiredField ? "high" : "medium";
}

/** Union of field names across a record set, sorted so output order is deterministic. */
function fieldUnion(records: Array<Record<string, unknown>>): string[] {
  const fields = new Set<string>();
  for (const record of records) {
    for (const field of Object.keys(record)) {
      fields.add(field);
    }
  }
  return [...fields].sort();
}

function keyOf(record: Record<string, unknown> | undefined, fields: string[]): string | null {
  return record ? buildIdentityKey(record, fields).key : null;
}

function duplicateGroups(
  records: Array<Record<string, unknown>>,
  fields: string[]
): Array<{ key: string; indexes: number[] }> {
  const byKey = new Map<string, number[]>();
  records.forEach((record, index) => {
    const { key } = buildIdentityKey(record, fields);
    if (key === null) return;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(index);
    else byKey.set(key, [index]);
  });

  return [...byKey.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([key, indexes]) => ({ key, indexes }));
}

/** Distinct configured key definitions, so identical primary and dedupe keys report once. */
function distinctKeyDefinitions(profile: SourceProfile): Array<{ name: string; fields: string[] }> {
  const definitions: Array<{ name: string; fields: string[] }> = [];
  const seen = new Set<string>();

  for (const entry of [
    { name: "primaryKey", fields: profile.primaryKey },
    { name: "dedupeKey", fields: profile.dedupeKey }
  ]) {
    if (entry.fields.length === 0) continue;
    const signature = JSON.stringify(entry.fields);
    if (seen.has(signature)) continue;
    seen.add(signature);
    definitions.push(entry);
  }

  return definitions;
}

export function runQa(
  referenceRecords: Array<Record<string, unknown>>,
  candidateRecords: Array<Record<string, unknown>>,
  profile: SourceProfile,
  options: QaOptions = {}
): QaReport {
  const matchReport = options.matchReport ?? matchRecords(referenceRecords, candidateRecords, profile);
  const validation = options.validation ?? profile.validation ?? {};
  const findings: Finding[] = [];

  const excluded = new Set(profile.excludedFields);
  const required = new Set(profile.hardRequiredFields);
  const candidateKeys = candidateRecords.map((record) => keyOf(record, profile.primaryKey));
  const referenceKeys = referenceRecords.map((record) => keyOf(record, profile.primaryKey));

  // ---- Dataset level: record-count anomaly -------------------------------------
  if (candidateRecords.length !== referenceRecords.length) {
    const delta = candidateRecords.length - referenceRecords.length;
    const drift = referenceRecords.length === 0 ? 1 : Math.abs(delta) / referenceRecords.length;
    const tolerance = profile.recordCountTolerance;
    const exceedsTolerance = typeof tolerance === "number" && drift > tolerance;

    findings.push(
      createFinding({
        severity: exceedsTolerance ? "high" : "info",
        category: "record_count_anomaly",
        fieldPath: null,
        recordKey: null,
        candidateValue: candidateRecords.length,
        referenceValue: referenceRecords.length,
        message: `Candidate holds ${candidateRecords.length} records against the reference's ${referenceRecords.length} (${delta > 0 ? "+" : ""}${delta}).`,
        evidence: {
          candidateCount: candidateRecords.length,
          referenceCount: referenceRecords.length,
          delta,
          drift,
          tolerance: tolerance ?? null,
          exceedsTolerance,
          // Without a configured tolerance this is reported, not judged.
          toleranceConfigured: typeof tolerance === "number"
        },
        recommendedAction: "report_only"
      })
    );
  }

  // ---- Dataset level: match rate against the profile minimum -------------------
  if (!matchReport.meetsMinimumMatchRate) {
    findings.push(
      createFinding({
        severity: "high",
        category: "identity_match_issue",
        fieldPath: null,
        recordKey: null,
        candidateValue: matchReport.matchRate,
        referenceValue: profile.minimumMatchRate,
        message: `Match rate ${matchReport.matchRate.toFixed(4)} is below the profile minimum ${profile.minimumMatchRate}.`,
        evidence: {
          matchRate: matchReport.matchRate,
          minimumMatchRate: profile.minimumMatchRate,
          counts: matchReport.counts
        },
        recommendedAction: "manual_review",
        discriminator: "match_rate_below_minimum"
      })
    );
  }

  // ---- Schema level: fields present in reference, absent from candidate --------
  const referenceFields = fieldUnion(referenceRecords);
  const candidateFields = new Set(fieldUnion(candidateRecords));

  for (const field of referenceFields) {
    if (candidateFields.has(field)) continue;
    findings.push(
      createFinding({
        severity: excluded.has(field) ? "info" : "high",
        category: "schema_field_missing",
        fieldPath: field,
        recordKey: null,
        candidateValue: null,
        referenceValue: null,
        message: `Field "${field}" appears in the reference schema but in no candidate record.`,
        evidence: {
          referenceRecordsWithField: referenceRecords.filter((record) => field in record).length,
          referenceRecordCount: referenceRecords.length
        },
        recommendedAction: resolveRecommendedAction(profile, field)
      })
    );
  }

  // ---- Identity level: duplicate configured keys -------------------------------
  for (const definition of distinctKeyDefinitions(profile)) {
    for (const side of [
      { name: "candidate", records: candidateRecords },
      { name: "reference", records: referenceRecords }
    ] as const) {
      for (const group of duplicateGroups(side.records, definition.fields)) {
        findings.push(
          createFinding({
            severity: "high",
            category: "duplicate_identity_key",
            fieldPath: definition.fields.join(","),
            recordKey: group.key,
            candidateValue: side.name === "candidate" ? group.indexes.length : null,
            referenceValue: side.name === "reference" ? group.indexes.length : null,
            message: `${group.indexes.length} ${side.name} records share the same ${definition.name} (${definition.fields.join(", ")}).`,
            evidence: {
              side: side.name,
              keyDefinition: definition.name,
              keyFields: definition.fields,
              keyValue: group.key,
              recordIndexes: group.indexes
            },
            recommendedAction: "manual_review",
            discriminator: `${definition.name}:${side.name}`
          })
        );
      }
    }
  }

  // ---- Record level: ambiguous or invalid identity ------------------------------
  for (const result of matchReport.results) {
    if (result.status !== "ambiguous_primary" && result.status !== "ambiguous_fallback" && result.status !== "invalid_identity") {
      continue;
    }

    const isInvalid = result.status === "invalid_identity";
    const side = result.candidateIndex !== null ? "candidate" : "reference";

    findings.push(
      createFinding({
        severity: "high",
        category: "identity_match_issue",
        fieldPath: result.keyFields ? result.keyFields.join(",") : null,
        recordKey: result.candidateKey ?? result.referenceKey,
        candidateValue: result.candidateIndex,
        referenceValue: result.referenceIndex,
        message: isInvalid
          ? `A ${side} record cannot be keyed on ${result.keyFields?.join(", ") ?? "the configured key"}.`
          : `A ${side} record could not be matched unambiguously (${result.status}).`,
        evidence: {
          status: result.status,
          side,
          candidateIndex: result.candidateIndex,
          referenceIndex: result.referenceIndex,
          ambiguity: result.ambiguity,
          invalidIdentity: result.invalidIdentity
        },
        // An unkeyable record cannot participate in comparison at all.
        recommendedAction: isInvalid ? "exclude" : "manual_review",
        discriminator: `${result.status}:${side}:${result.candidateIndex ?? result.referenceIndex}`
      })
    );
  }

  // ---- Record level: required fields and configured validation ------------------
  candidateRecords.forEach((record, candidateIndex) => {
    const recordKey = candidateKeys[candidateIndex];

    for (const field of profile.hardRequiredFields) {
      const present = field in record;
      const value = present ? record[field] : undefined;
      if (present && !isEmpty(value)) continue;

      findings.push(
        createFinding({
          severity: "critical",
          category: "required_field_missing",
          fieldPath: field,
          recordKey,
          candidateValue: present ? value : null,
          referenceValue: null,
          message: present
            ? `Required field "${field}" is present but unpopulated.`
            : `Required field "${field}" is absent from the record.`,
          evidence: { candidateIndex, present, blank: present },
          recommendedAction: resolveRecommendedAction(profile, field, {
            candidateIsBlank: isBlankStrict(value)
          }),
          discriminator: String(candidateIndex)
        })
      );
    }

    for (const [kind, fields] of Object.entries(validation) as Array<[ValidationKind, string[] | undefined]>) {
      for (const field of fields ?? []) {
        if (!(field in record)) continue;
        const value = record[field];
        // Blank values are the required-field check's business, not validation's.
        if (isEmpty(value)) continue;
        if (typeof value !== "string") {
          findings.push(
            createFinding({
              severity: validationSeverity(kind, required.has(field)),
              category: "field_validation_failure",
              fieldPath: field,
              recordKey,
              candidateValue: value,
              referenceValue: null,
              message: `Field "${field}" is configured as ${kind} but holds a ${typeof value}.`,
              evidence: { candidateIndex, rule: kind, reason: `expected string, received ${typeof value}` },
              recommendedAction: resolveRecommendedAction(profile, field),
              discriminator: `${kind}:${candidateIndex}`
            })
          );
          continue;
        }

        const outcome = VALIDATORS[kind](value);
        if (outcome.valid) continue;

        findings.push(
          createFinding({
            severity: validationSeverity(kind, required.has(field)),
            category: "field_validation_failure",
            fieldPath: field,
            recordKey,
            candidateValue: value,
            referenceValue: null,
            message: `Field "${field}" failed ${kind} validation: ${outcome.reason}.`,
            evidence: { candidateIndex, rule: kind, reason: outcome.reason, heuristic: HEURISTIC_KINDS.has(kind) },
            recommendedAction: resolveRecommendedAction(profile, field),
            discriminator: `${kind}:${candidateIndex}`
          })
        );
      }
    }
  });

  // ---- Matched pairs: regression and conflict -----------------------------------
  const matchedPairs = matchReport.results.filter(
    (result: MatchResult) =>
      (result.status === "matched_primary" || result.status === "matched_fallback") &&
      result.candidateIndex !== null &&
      result.referenceIndex !== null
  );

  for (const pair of matchedPairs) {
    const candidate = candidateRecords[pair.candidateIndex as number];
    const reference = referenceRecords[pair.referenceIndex as number];
    const recordKey = candidateKeys[pair.candidateIndex as number] ?? referenceKeys[pair.referenceIndex as number];
    const comparableFields = [...new Set([...Object.keys(reference), ...Object.keys(candidate)])].sort();

    for (const field of comparableFields) {
      if (excluded.has(field)) continue;

      const referenceValue = reference[field];
      const candidateValue = candidate[field];
      const referenceBlank = isEmpty(referenceValue);
      const candidateBlank = isEmpty(candidateValue);

      if (referenceBlank) continue;

      if (candidateBlank) {
        findings.push(
          createFinding({
            severity: required.has(field) ? "critical" : "high",
            category: "field_regression",
            fieldPath: field,
            recordKey,
            candidateValue: candidateValue ?? null,
            referenceValue,
            message: `Field "${field}" held a value in the reference and is unpopulated in the candidate.`,
            evidence: {
              candidateIndex: pair.candidateIndex,
              referenceIndex: pair.referenceIndex,
              matchMethod: pair.matchMethod,
              matchKeyFields: pair.keyFields
            },
            // Rule 4's emptiness precondition, checked strictly.
            recommendedAction: resolveRecommendedAction(profile, field, {
              candidateIsBlank: isBlankStrict(candidateValue) || !(field in candidate)
            }),
            discriminator: String(pair.candidateIndex)
          })
        );
        continue;
      }

      if (!valuesEqual(candidateValue, referenceValue)) {
        findings.push(
          createFinding({
            severity: "medium",
            category: "field_conflict",
            fieldPath: field,
            recordKey,
            candidateValue,
            referenceValue,
            message: `Field "${field}" holds different non-blank values in the reference and the candidate.`,
            evidence: {
              candidateIndex: pair.candidateIndex,
              referenceIndex: pair.referenceIndex,
              matchMethod: pair.matchMethod
            },
            // Never backfillable: rule 3 protects a non-blank candidate value.
            recommendedAction: excluded.has(field) ? "exclude" : "manual_review",
            discriminator: String(pair.candidateIndex)
          })
        );
      }
    }
  }

  return {
    profileId: profile.id,
    profileVersion: profile.version,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sourceRun: options.sourceRun ?? null,
    referenceRun: options.referenceRun ?? null,
    matchingKey: profile.primaryKey,
    candidateCount: candidateRecords.length,
    referenceCount: referenceRecords.length,
    matchReport,
    findings,
    counts: summarizeFindings(findings)
  };
}
