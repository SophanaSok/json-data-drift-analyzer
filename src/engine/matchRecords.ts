/**
 * Deterministic record matching between a reference (known-good) export and a
 * candidate (suspected-bad) export.
 *
 * Scope, per AGENTS.md:
 * - Exact key matching only. There is no fuzzy matching here and no code path that
 *   could introduce one (rule 5).
 * - Nothing is recovered, merged, mutated, or exported (rules 2, 3). Records are
 *   referenced by index; the input arrays and their objects are never written to,
 *   and no record object is returned, so a caller cannot mutate through a result.
 * - Every outcome carries the evidence needed to explain it (rule 7).
 *
 * Matching is a two-pass process:
 *   1. Primary key across all records.
 *   2. Fallback keys, in profile order, over candidates and references left
 *      unmatched by pass 1.
 *
 * A reference claimed in pass 1 is not available in pass 2 — primary key matches
 * are authoritative, and allowing a fallback to re-claim a reference would produce
 * a double assignment.
 *
 * Fallback AMBIGUITY, however, is judged against the FULL reference population, not
 * just the references still unclaimed. A fallback key carried by two reference
 * records proves nothing about identity even after one of them was claimed on the
 * primary key — treating the survivor as unique would quietly pair (and backfill
 * from) whichever sibling happened to be left over.
 */

import { buildIdentityKey, type IdentityKey } from "./normalize";
import type { SourceProfile } from "./adapter-types";

export type MatchStatus =
  | "matched_primary"
  | "matched_fallback"
  | "candidate_only"
  | "reference_only"
  | "ambiguous_primary"
  | "ambiguous_fallback"
  | "invalid_identity";

export type MatchMethod = "primary" | "fallback";

export type AmbiguityDetail = {
  /** Fields that produced the colliding key. */
  keyFields: string[];
  /** The key value that collided. */
  keyValue: string;
  /** Every reference record carrying this key. */
  referenceIndexes: number[];
  /** Every candidate record carrying this key. */
  candidateIndexes: number[];
  /** Which side (or both) made the match non-unique. */
  side: "reference" | "candidate" | "both";
};

export type InvalidIdentityDetail = {
  keyFields: string[];
  /** Fields absent from the record. */
  missingFields: string[];
  /** Fields present but blank, whitespace-only, or non-scalar. */
  blankFields: string[];
};

export type MatchResult = {
  status: MatchStatus;
  /** Index into the candidate array, or null for reference-side-only outcomes. */
  candidateIndex: number | null;
  /** Index into the reference array, or null when nothing was matched. */
  referenceIndex: number | null;
  /** Normalized candidate key, null when it could not be built. */
  candidateKey: string | null;
  /** Normalized reference key, null when nothing was matched. */
  referenceKey: string | null;
  /** How the pairing was made; null when there was no pairing. */
  matchMethod: MatchMethod | null;
  /** Fields that produced the key used for this outcome. */
  keyFields: string[] | null;
  ambiguity: AmbiguityDetail | null;
  invalidIdentity: InvalidIdentityDetail | null;
};

export type MatchReport = {
  profileId: string;
  profileVersion: number;
  candidateCount: number;
  referenceCount: number;
  primaryKey: string[];
  /** Fallback keys actually considered. Empty when the profile permits none. */
  fallbackKeysUsed: string[][];
  /** One row per candidate, then one row per unmatched reference. */
  results: MatchResult[];
  counts: Record<MatchStatus, number>;
  /** (matched_primary + matched_fallback) / candidateCount; 0 when there are no candidates. */
  matchRate: number;
  meetsMinimumMatchRate: boolean;
};

const EMPTY_COUNTS: Record<MatchStatus, number> = {
  matched_primary: 0,
  matched_fallback: 0,
  candidate_only: 0,
  reference_only: 0,
  ambiguous_primary: 0,
  ambiguous_fallback: 0,
  invalid_identity: 0
};

function indexByKey(keys: Array<IdentityKey>, eligible: (index: number) => boolean): Map<string, number[]> {
  const index = new Map<string, number[]>();
  keys.forEach((identity, position) => {
    if (identity.key === null || !eligible(position)) {
      return;
    }
    const bucket = index.get(identity.key);
    if (bucket) {
      bucket.push(position);
    } else {
      index.set(identity.key, [position]);
    }
  });
  return index;
}

function ambiguitySide(referenceIndexes: number[], candidateIndexes: number[]): AmbiguityDetail["side"] {
  const referenceDuplicated = referenceIndexes.length > 1;
  const candidateDuplicated = candidateIndexes.length > 1;
  if (referenceDuplicated && candidateDuplicated) return "both";
  return referenceDuplicated ? "reference" : "candidate";
}

/**
 * Match candidate records against reference records using the profile's keys.
 *
 * @param referenceRecords - records from the known-good export
 * @param candidateRecords - records from the export under investigation
 * @param profile - supplies primaryKey, fallbackKeys, and minimumMatchRate
 */
export function matchRecords(
  referenceRecords: Array<Record<string, unknown>>,
  candidateRecords: Array<Record<string, unknown>>,
  profile: SourceProfile
): MatchReport {
  const primaryKey = profile.primaryKey;
  // An empty fallbackKeys list is how a profile declines to permit fallback matching.
  const fallbackKeys = profile.fallbackKeys.filter((fields) => fields.length > 0);

  const referencePrimary = referenceRecords.map((record) => buildIdentityKey(record, primaryKey));
  const candidatePrimary = candidateRecords.map((record) => buildIdentityKey(record, primaryKey));

  const results: MatchResult[] = [];
  const matchedReference = new Set<number>();
  const candidateOutcome = new Array<MatchResult | null>(candidateRecords.length).fill(null);

  const referenceByPrimary = indexByKey(referencePrimary, () => true);
  const candidateByPrimary = indexByKey(candidatePrimary, () => true);

  // Pass 1 — primary key.
  candidatePrimary.forEach((identity, candidateIndex) => {
    if (identity.key === null) {
      candidateOutcome[candidateIndex] = {
        status: "invalid_identity",
        candidateIndex,
        referenceIndex: null,
        candidateKey: null,
        referenceKey: null,
        matchMethod: null,
        keyFields: primaryKey,
        ambiguity: null,
        invalidIdentity: {
          keyFields: primaryKey,
          missingFields: identity.missingFields,
          blankFields: identity.blankFields
        }
      };
      return;
    }

    const referenceIndexes = referenceByPrimary.get(identity.key) ?? [];
    const candidateIndexes = candidateByPrimary.get(identity.key) ?? [];

    // Duplicates on either side make a 1:1 pairing undecidable without guessing.
    if (referenceIndexes.length > 1 || candidateIndexes.length > 1) {
      candidateOutcome[candidateIndex] = {
        status: "ambiguous_primary",
        candidateIndex,
        referenceIndex: null,
        candidateKey: identity.key,
        referenceKey: null,
        matchMethod: null,
        keyFields: primaryKey,
        ambiguity: {
          keyFields: primaryKey,
          keyValue: identity.key,
          referenceIndexes,
          candidateIndexes,
          side: ambiguitySide(referenceIndexes, candidateIndexes)
        },
        invalidIdentity: null
      };
      return;
    }

    if (referenceIndexes.length === 1) {
      const referenceIndex = referenceIndexes[0]!;
      matchedReference.add(referenceIndex);
      candidateOutcome[candidateIndex] = {
        status: "matched_primary",
        candidateIndex,
        referenceIndex,
        candidateKey: identity.key,
        referenceKey: referencePrimary[referenceIndex]!.key,
        matchMethod: "primary",
        keyFields: primaryKey,
        ambiguity: null,
        invalidIdentity: null
      };
    }
    // Zero reference matches: left unresolved for pass 2.
  });

  // Pass 2 — fallback keys, over what pass 1 left unmatched.
  if (fallbackKeys.length > 0) {
    for (const fallbackFields of fallbackKeys) {
      const unmatchedCandidates = candidateOutcome
        .map((outcome, index) => (outcome === null ? index : -1))
        .filter((index) => index >= 0);

      if (unmatchedCandidates.length === 0) {
        break;
      }

      const referenceFallback = referenceRecords.map((record) => buildIdentityKey(record, fallbackFields));
      const candidateFallback = candidateRecords.map((record) => buildIdentityKey(record, fallbackFields));

      // ALL references, claimed or not: a key that collides anywhere in the
      // reference set cannot prove identity (see the module doc). Rule 4's
      // "exactly one reference match exists" is read over the whole export.
      const referenceIndex = indexByKey(referenceFallback, () => true);
      // Candidates still unmatched only: this side exists to stop two live
      // candidates claiming one key, and a candidate already matched on its
      // primary key is not competing.
      const candidateIndex = indexByKey(candidateFallback, (position) => candidateOutcome[position] === null);

      for (const position of unmatchedCandidates) {
        // `position` indexes candidateOutcome, which is sized to candidateRecords,
        // and candidateFallback maps candidateRecords 1:1.
        const identity = candidateFallback[position]!;
        if (identity.key === null) {
          // This candidate cannot be keyed on this fallback; later fallbacks may still apply.
          continue;
        }

        const referenceMatches = referenceIndex.get(identity.key) ?? [];
        const candidateMatches = candidateIndex.get(identity.key) ?? [];

        if (referenceMatches.length > 1 || candidateMatches.length > 1) {
          candidateOutcome[position] = {
            status: "ambiguous_fallback",
            candidateIndex: position,
            referenceIndex: null,
            candidateKey: identity.key,
            referenceKey: null,
            matchMethod: null,
            keyFields: fallbackFields,
            ambiguity: {
              keyFields: fallbackFields,
              keyValue: identity.key,
              referenceIndexes: referenceMatches,
              candidateIndexes: candidateMatches,
              side: ambiguitySide(referenceMatches, candidateMatches)
            },
            invalidIdentity: null
          };
          continue;
        }

        // Requirement: fallback applies only when it yields exactly one reference
        // match — and that sole carrier must still be unclaimed. A claimed sole
        // carrier means this candidate has no counterpart, not a different one.
        if (referenceMatches.length === 1 && !matchedReference.has(referenceMatches[0]!)) {
          const matchedIndex = referenceMatches[0]!;
          matchedReference.add(matchedIndex);
          candidateOutcome[position] = {
            status: "matched_fallback",
            candidateIndex: position,
            referenceIndex: matchedIndex,
            candidateKey: identity.key,
            referenceKey: referenceFallback[matchedIndex]!.key,
            matchMethod: "fallback",
            keyFields: fallbackFields,
            ambiguity: null,
            invalidIdentity: null
          };
        }
      }
    }
  }

  // Anything still unresolved on the candidate side has no reference counterpart.
  candidateOutcome.forEach((outcome, candidateIndex) => {
    if (outcome !== null) {
      results.push(outcome);
      return;
    }
    results.push({
      status: "candidate_only",
      candidateIndex,
      referenceIndex: null,
      candidateKey: candidatePrimary[candidateIndex]!.key,
      referenceKey: null,
      matchMethod: null,
      keyFields: primaryKey,
      ambiguity: null,
      invalidIdentity: null
    });
  });

  // Reference side: one row per record never claimed by a match.
  referencePrimary.forEach((identity, referenceIndex) => {
    if (matchedReference.has(referenceIndex)) {
      return;
    }

    if (identity.key === null) {
      results.push({
        status: "invalid_identity",
        candidateIndex: null,
        referenceIndex,
        candidateKey: null,
        referenceKey: null,
        matchMethod: null,
        keyFields: primaryKey,
        ambiguity: null,
        invalidIdentity: {
          keyFields: primaryKey,
          missingFields: identity.missingFields,
          blankFields: identity.blankFields
        }
      });
      return;
    }

    const referenceIndexes = referenceByPrimary.get(identity.key) ?? [];
    const candidateIndexes = candidateByPrimary.get(identity.key) ?? [];

    if (referenceIndexes.length > 1 || candidateIndexes.length > 1) {
      results.push({
        status: "ambiguous_primary",
        candidateIndex: null,
        referenceIndex,
        candidateKey: null,
        referenceKey: identity.key,
        matchMethod: null,
        keyFields: primaryKey,
        ambiguity: {
          keyFields: primaryKey,
          keyValue: identity.key,
          referenceIndexes,
          candidateIndexes,
          side: ambiguitySide(referenceIndexes, candidateIndexes)
        },
        invalidIdentity: null
      });
      return;
    }

    results.push({
      status: "reference_only",
      candidateIndex: null,
      referenceIndex,
      candidateKey: null,
      referenceKey: identity.key,
      matchMethod: null,
      keyFields: primaryKey,
      ambiguity: null,
      invalidIdentity: null
    });
  });

  const counts: Record<MatchStatus, number> = { ...EMPTY_COUNTS };
  for (const result of results) {
    counts[result.status] += 1;
  }

  const matchedCount = counts.matched_primary + counts.matched_fallback;
  const matchRate = candidateRecords.length === 0 ? 0 : matchedCount / candidateRecords.length;

  return {
    profileId: profile.id,
    profileVersion: profile.version,
    candidateCount: candidateRecords.length,
    referenceCount: referenceRecords.length,
    primaryKey,
    fallbackKeysUsed: fallbackKeys,
    results,
    counts,
    matchRate,
    meetsMinimumMatchRate: matchRate >= profile.minimumMatchRate
  };
}
