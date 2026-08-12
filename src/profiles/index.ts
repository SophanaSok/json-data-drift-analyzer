/**
 * Source profile registry.
 *
 * `src/profiles/*.json` is the single source of truth for what each source permits.
 * The profile used to be duplicated across four test files and a document, which had
 * to be edited in lockstep and could drift silently — an approval recorded in one
 * place and missed in another is exactly the failure the audit trail exists to
 * prevent.
 *
 * The JSON is typed as `SourceProfile` on import, so a profile that no longer matches
 * the type is a compile error rather than a runtime surprise. `assertProfileInvariants`
 * covers the rules the type cannot express.
 */

import bellinghamProcureware from "./bellingham-procureware.json";
import type { SourceProfile } from "../engine/adapter-types";

export const BELLINGHAM_PROCUREWARE: SourceProfile = bellinghamProcureware as SourceProfile;

export const PROFILES: Record<string, SourceProfile> = {
  [BELLINGHAM_PROCUREWARE.id]: BELLINGHAM_PROCUREWARE
};

/**
 * Refuse to serve a profile whose rules contradict each other.
 *
 * The `as SourceProfile` cast above is unavoidable for imported JSON, which means
 * the type system never checked the file; this is where a bad edit fails loudly
 * instead of silently governing recovery.
 */
export function assertProfileCoherent(profile: SourceProfile): SourceProfile {
  const problems = findProfileContradictions(profile);
  if (problems.length > 0) {
    throw new Error(`Profile "${profile.id}" is self-contradictory and cannot be used: ${problems.join(" ")}`);
  }
  return profile;
}

export function getProfile(id: string): SourceProfile | null {
  const profile = PROFILES[id];
  return profile ? assertProfileCoherent(profile) : null;
}

/**
 * Contradictions a profile can express that the type system cannot catch.
 *
 * Each of these would silently change what recovery is permitted to do, so they are
 * checked rather than trusted.
 *
 * @returns the problems found; empty when the profile is coherent
 */
export function findProfileContradictions(profile: SourceProfile): string[] {
  const problems: string[] = [];
  const backfillable = new Set(profile.safeBackfillFields);
  const manualReview = new Set(profile.manualReviewFields);
  const excluded = new Set(profile.excludedFields);

  for (const field of backfillable) {
    if (manualReview.has(field)) {
      problems.push(`"${field}" is both safeBackfill and manualReview; it cannot be automatic and human-only at once.`);
    }
    if (excluded.has(field)) {
      problems.push(`"${field}" is both safeBackfill and excluded; an excluded field is never compared, so it can never be recovered.`);
    }
  }

  if (profile.primaryKey.length === 0) {
    problems.push("primaryKey is empty; no record can be identified.");
  }
  if (profile.collectionPath.length === 0) {
    problems.push("collectionPath is empty; the records array cannot be located.");
  }
  if (profile.minimumMatchRate < 0 || profile.minimumMatchRate > 1) {
    problems.push(`minimumMatchRate ${profile.minimumMatchRate} is outside 0..1.`);
  }
  if (profile.version < 1) {
    problems.push(`version ${profile.version} is not a positive integer; provenance could not identify the governing policy.`);
  }

  return problems;
}
