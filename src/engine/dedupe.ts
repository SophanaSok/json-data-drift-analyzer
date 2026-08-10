/**
 * Deterministic deduplication of a recovered artifact.
 *
 * Ordering is structural: `runDedupe` takes a `RecoveryResult`, so it cannot run
 * before recovery. That matters — recovery can populate the very fields used to
 * judge completeness, so deduplicating first would pick winners on stale evidence.
 *
 * Grouping uses the profile's `dedupeKey` and nothing else. There is no fuzzy
 * matching here and no code path that could introduce one: records are grouped only
 * by exact normalized key equality, so a record is never removed on a similarity
 * judgement (AGENTS.md rule 5).
 *
 * Nothing disappears silently. Every participant is accounted for in exactly one of
 * `retained`, `removed`, or `carriedExcluded`, and `summary.accountedFor` asserts it.
 */

import { isEmpty } from "./empty";
import { buildIdentityKey } from "./normalize";
import type { RecoveryResult } from "./recovery";
import type { SourceProfile } from "./adapter-types";

export type DedupeValidity = "valid" | "excluded";

export type DedupeParticipant = {
  /** Primary identity key carried over from recovery. */
  recordKey: string | null;
  /** Normalized composite dedupe key; null when the record cannot be keyed. */
  dedupeKey: string | null;
  candidateIndex: number | null;
  validity: DedupeValidity;
  /** True when any value in this record came from the reference export. */
  containsReferenceDerivedValues: boolean;
  /** Count of profile hard-required fields holding a value. */
  requiredFieldsPresent: number;
  /** Stable input order. Unique, and the final tie-breaker. */
  position: number;
};

export type RemovalReason =
  /** Loser was excluded by recovery; the winner is a valid record. */
  | "duplicate_lost_to_valid_record"
  /** Loser carried reference-derived values; the winner is candidate-sourced. */
  | "duplicate_lost_to_candidate_sourced_record"
  /** Loser had fewer populated hard-required fields. */
  | "duplicate_lost_to_more_complete_record"
  /** Every criterion tied; the winner appeared first in input order. */
  | "duplicate_lost_to_earlier_record";

export type RemovedRecord = {
  dedupeKey: string;
  removed: DedupeParticipant;
  winner: DedupeParticipant;
  reason: RemovalReason;
  detail: string;
};

export type DuplicateGroup = {
  dedupeKey: string;
  memberCount: number;
  winner: DedupeParticipant;
  removed: RemovedRecord[];
};

export type DedupeSummary = {
  participantCount: number;
  retainedCount: number;
  removedCount: number;
  carriedExcludedCount: number;
  /** Records with no usable dedupe key. Never removed — duplication is unprovable. */
  unkeyableCount: number;
  duplicateGroupCount: number;
  removedByReason: Record<RemovalReason, number>;
  /** True when retained + removed + carriedExcluded equals participantCount. */
  accountedFor: boolean;
};

export type DedupeResult = {
  profileId: string;
  profileVersion: number;
  generatedAt: string;
  dedupeKeyFields: string[];
  /** Valid records surviving into the final artifact, in stable input order. */
  retained: DedupeParticipant[];
  /** Duplicates dropped, each with its winner and the rule that decided it. */
  removed: RemovedRecord[];
  /** Recovery-excluded records that were not also removed as duplicates. */
  carriedExcluded: DedupeParticipant[];
  /** Every key with more than one member. */
  groups: DuplicateGroup[];
  summary: DedupeSummary;
};

export type DedupeOptions = {
  /** ISO-8601 timestamp. Injectable so identical inputs produce identical output. */
  generatedAt?: string;
};

const ZERO_REASONS: Record<RemovalReason, number> = {
  duplicate_lost_to_valid_record: 0,
  duplicate_lost_to_candidate_sourced_record: 0,
  duplicate_lost_to_more_complete_record: 0,
  duplicate_lost_to_earlier_record: 0
};

function countRequiredPresent(record: Record<string, unknown> | null, profile: SourceProfile): number {
  if (record === null) return 0;
  return profile.hardRequiredFields.filter((field) => field in record && !isEmpty(record[field])).length;
}

const validityRank = (validity: DedupeValidity): number => (validity === "valid" ? 0 : 1);
const provenanceRank = (participant: DedupeParticipant): number =>
  participant.containsReferenceDerivedValues ? 1 : 0;

/** Position in the candidate export — the real input order. */
const inputOrder = (participant: DedupeParticipant): number =>
  participant.candidateIndex ?? Number.MAX_SAFE_INTEGER;

/**
 * Total order over duplicate-group members. Lower sorts first and wins.
 *
 * Criteria run in the order the policy states. The final tie-breaker is position in
 * the candidate export, not position in the participant list — the participant list
 * puts recovered records before excluded ones, which is stable but is not input
 * order. `position` remains as an absolute backstop so the comparator can never
 * report two members as equal.
 *
 * Note on completeness: a record missing a hard-required field is excluded by
 * recovery, so among two VALID records this criterion always ties. It does real work
 * when both records were excluded — it picks the most complete of a bad set.
 */
function compareParticipants(left: DedupeParticipant, right: DedupeParticipant): number {
  const byValidity = validityRank(left.validity) - validityRank(right.validity);
  if (byValidity !== 0) return byValidity;

  const byProvenance = provenanceRank(left) - provenanceRank(right);
  if (byProvenance !== 0) return byProvenance;

  // More populated hard-required fields wins, so compare descending.
  const byCompleteness = right.requiredFieldsPresent - left.requiredFieldsPresent;
  if (byCompleteness !== 0) return byCompleteness;

  const byInputOrder = inputOrder(left) - inputOrder(right);
  if (byInputOrder !== 0) return byInputOrder;

  return left.position - right.position;
}

/** Which criterion actually separated the winner from this loser. */
function decidingReason(winner: DedupeParticipant, loser: DedupeParticipant): RemovalReason {
  if (validityRank(winner.validity) !== validityRank(loser.validity)) {
    return "duplicate_lost_to_valid_record";
  }
  if (provenanceRank(winner) !== provenanceRank(loser)) {
    return "duplicate_lost_to_candidate_sourced_record";
  }
  if (winner.requiredFieldsPresent !== loser.requiredFieldsPresent) {
    return "duplicate_lost_to_more_complete_record";
  }
  return "duplicate_lost_to_earlier_record";
}

function describe(reason: RemovalReason, winner: DedupeParticipant, loser: DedupeParticipant): string {
  switch (reason) {
    case "duplicate_lost_to_valid_record":
      return `Removed record was ${loser.validity}; retained record is ${winner.validity}.`;
    case "duplicate_lost_to_candidate_sourced_record":
      return "Removed record carried reference-derived values; retained record is candidate-sourced.";
    case "duplicate_lost_to_more_complete_record":
      return `Retained record populates ${winner.requiredFieldsPresent} hard-required fields against the removed record's ${loser.requiredFieldsPresent}.`;
    case "duplicate_lost_to_earlier_record":
      return `All criteria tied; retained record appeared earlier in the candidate export (index ${inputOrder(winner)} before ${inputOrder(loser)}).`;
  }
}

/**
 * Deduplicate a recovered artifact.
 *
 * @param recovery - output of runRecovery; taking this type is what enforces ordering
 * @param candidateRecords - the raw candidate array, used to score records that
 *   recovery excluded (an ExcludedRecord carries no record object of its own)
 * @param profile - supplies dedupeKey and hardRequiredFields
 */
export function runDedupe(
  recovery: RecoveryResult,
  candidateRecords: Array<Record<string, unknown>>,
  profile: SourceProfile,
  options: DedupeOptions = {}
): DedupeResult {
  const dedupeKeyFields = profile.dedupeKey;
  const participants: DedupeParticipant[] = [];

  // Recovered records first, then recovery's exclusions. Both are already in a
  // deterministic order, so `position` is stable across runs.
  recovery.recovered.forEach((record) => {
    participants.push({
      recordKey: record.recordKey,
      dedupeKey: dedupeKeyFields.length === 0 ? null : buildIdentityKey(record.record, dedupeKeyFields).key,
      candidateIndex: record.candidateIndex,
      validity: "valid",
      containsReferenceDerivedValues: record.containsReferenceDerivedValues,
      requiredFieldsPresent: countRequiredPresent(record.record, profile),
      position: participants.length
    });
  });

  recovery.excluded.forEach((record) => {
    const source =
      record.candidateIndex !== null && record.candidateIndex < candidateRecords.length
        ? candidateRecords[record.candidateIndex]
        : null;

    participants.push({
      recordKey: record.recordKey,
      dedupeKey: source === null || dedupeKeyFields.length === 0 ? null : buildIdentityKey(source, dedupeKeyFields).key,
      candidateIndex: record.candidateIndex,
      validity: "excluded",
      containsReferenceDerivedValues: false,
      requiredFieldsPresent: countRequiredPresent(source, profile),
      position: participants.length
    });
  });

  // Group by exact normalized key. Unkeyable records are never grouped: without a
  // key there is no evidence of duplication, and guessing is exactly what rule 5
  // forbids.
  const groupsByKey = new Map<string, DedupeParticipant[]>();
  const unkeyable: DedupeParticipant[] = [];

  for (const participant of participants) {
    if (participant.dedupeKey === null) {
      unkeyable.push(participant);
      continue;
    }
    const bucket = groupsByKey.get(participant.dedupeKey);
    if (bucket) bucket.push(participant);
    else groupsByKey.set(participant.dedupeKey, [participant]);
  }

  const removed: RemovedRecord[] = [];
  const groups: DuplicateGroup[] = [];
  const removedPositions = new Set<number>();

  // Iterate keys in first-appearance order so the audit log is deterministic.
  for (const [dedupeKey, members] of groupsByKey) {
    if (members.length < 2) continue;

    const ranked = [...members].sort(compareParticipants);
    const winner = ranked[0];
    const losers = ranked.slice(1);

    const groupRemovals = losers
      // Report in input order rather than ranked order, so the log reads like the file.
      .sort((left, right) => left.position - right.position)
      .map((loser) => {
        const reason = decidingReason(winner, loser);
        removedPositions.add(loser.position);
        return {
          dedupeKey,
          removed: loser,
          winner,
          reason,
          detail: describe(reason, winner, loser)
        };
      });

    removed.push(...groupRemovals);
    groups.push({ dedupeKey, memberCount: members.length, winner, removed: groupRemovals });
  }

  const survivors = participants.filter((participant) => !removedPositions.has(participant.position));
  const retained = survivors.filter((participant) => participant.validity === "valid");
  const carriedExcluded = survivors.filter((participant) => participant.validity === "excluded");

  const removedByReason = { ...ZERO_REASONS };
  for (const record of removed) {
    removedByReason[record.reason] += 1;
  }

  return {
    profileId: profile.id,
    profileVersion: profile.version,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    dedupeKeyFields,
    retained,
    removed,
    carriedExcluded,
    groups,
    summary: {
      participantCount: participants.length,
      retainedCount: retained.length,
      removedCount: removed.length,
      carriedExcludedCount: carriedExcluded.length,
      unkeyableCount: unkeyable.length,
      duplicateGroupCount: groups.length,
      removedByReason,
      accountedFor: retained.length + removed.length + carriedExcluded.length === participants.length
    }
  };
}
