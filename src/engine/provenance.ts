/**
 * Provenance vocabulary for recovered artifacts.
 *
 * AGENTS.md rule 9 in spirit: a recovered artifact must never present a
 * reference-derived value as though the candidate run produced it. Every value in a
 * recovered record therefore has a defined source, and any value that did not come
 * from the candidate export is recorded explicitly.
 *
 * Rule 7 requires source run, reference run, matching key, rule/profile version,
 * timestamp, original value, output value, and reason on every audited action. A
 * ProvenanceEntry carries all of them.
 */

export type ProvenanceSource =
  /** The value as it appeared in the candidate export. */
  | "candidate"
  /** Copied from the matched reference record because the profile permitted it. */
  | "reference_backfill"
  /** Supplied by a person, overriding what either export held. */
  | "manual_override";

export type ProvenanceEntry = {
  /** Identity key of the record this value belongs to. */
  recordKey: string;
  /** Field whose value this entry explains. */
  field: string;
  source: ProvenanceSource;
  /** Value before the action. */
  originalValue: unknown;
  /** Value written to the recovered artifact. */
  outputValue: unknown;
  /** Why the action was taken. */
  reason: string;
  /** Identifier of the rule or policy that authorized it. */
  ruleId: string;
  /** Who acted. Automatic backfill is "auto"; a person is "user". */
  actor: "auto" | "user";
  candidateIndex: number | null;
  referenceIndex: number | null;
  /** Match status that made the pairing usable, when one was involved. */
  matchStatus: string | null;
  /** Fields that produced the match key. */
  matchingKey: string[];
  profileId: string;
  profileVersion: number;
  sourceRun: string | null;
  referenceRun: string | null;
  timestamp: string;
};

/** Run-level identity shared by every entry from a single recovery run. */
export type ProvenanceEnvelope = {
  profileId: string;
  profileVersion: number;
  matchingKey: string[];
  sourceRun: string | null;
  referenceRun: string | null;
  timestamp: string;
};

export type ProvenanceEventInput = {
  recordKey: string;
  field: string;
  source: Exclude<ProvenanceSource, "candidate">;
  originalValue: unknown;
  outputValue: unknown;
  reason: string;
  ruleId: string;
  actor: "auto" | "user";
  candidateIndex: number | null;
  referenceIndex: number | null;
  matchStatus: string | null;
  /**
   * Fields that actually produced this record's pairing. Rule 7 asks for the
   * matching key, and a fallback match was not made on the primary key — recording
   * the profile's primary key there would misstate how the pairing was reached.
   * Falls back to the envelope's key when the event involved no pairing.
   */
  matchingKey?: string[];
};

export function createProvenanceEntry(
  envelope: ProvenanceEnvelope,
  event: ProvenanceEventInput
): ProvenanceEntry {
  const { matchingKey, ...rest } = event;
  return {
    ...rest,
    matchingKey: matchingKey ?? envelope.matchingKey,
    profileId: envelope.profileId,
    profileVersion: envelope.profileVersion,
    sourceRun: envelope.sourceRun,
    referenceRun: envelope.referenceRun,
    timestamp: envelope.timestamp
  };
}

export type RecordProvenance = {
  recordKey: string;
  /** Complete field-to-source map for the record. Total: every output field appears. */
  fields: Record<string, ProvenanceSource>;
  /** Fields whose value did not come from the candidate run. */
  nonCandidateFields: string[];
  /** True when any value in this record came from the reference export. */
  containsReferenceDerivedValues: boolean;
  entries: ProvenanceEntry[];
};

/**
 * Materialize the complete provenance map for one recovered record.
 *
 * Only non-candidate events are stored in the recovery log — recording an entry for
 * every unchanged field would produce tens of thousands of rows saying "unchanged".
 * Provenance is still total: any field without an event came from the candidate
 * export by definition, and this function makes that explicit for a given record.
 */
export function buildRecordProvenance(
  recordKey: string,
  record: Record<string, unknown>,
  entries: ProvenanceEntry[]
): RecordProvenance {
  const forRecord = entries.filter((entry) => entry.recordKey === recordKey);
  const fields: Record<string, ProvenanceSource> = {};

  for (const field of Object.keys(record)) {
    fields[field] = "candidate";
  }
  for (const entry of forRecord) {
    fields[entry.field] = entry.source;
  }

  const nonCandidateFields = Object.keys(fields)
    .filter((field) => fields[field] !== "candidate")
    .sort();

  return {
    recordKey,
    fields,
    nonCandidateFields,
    containsReferenceDerivedValues: forRecord.some((entry) => entry.source === "reference_backfill"),
    entries: forRecord
  };
}

/**
 * Source of a single field, defaulting to "candidate" when no event changed it.
 *
 * The LAST applicable event wins, matching how `buildRecordProvenance` folds events
 * into its map and how the value itself was produced: a field that was backfilled and
 * then manually overridden is a manual_override, not a reference_backfill.
 */
export function resolveFieldProvenance(
  recordKey: string,
  field: string,
  entries: ProvenanceEntry[]
): ProvenanceSource {
  let source: ProvenanceSource = "candidate";
  for (const entry of entries) {
    if (entry.recordKey === recordKey && entry.field === field) {
      source = entry.source;
    }
  }
  return source;
}
