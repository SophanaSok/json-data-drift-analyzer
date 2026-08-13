/**
 * Source profile registry.
 *
 * `src/profiles/base.json` + `src/profiles/sources/*.json` are the single
 * source of truth for what each source permits. Every file under `sources/` is
 * auto-registered — adding a source is adding a delta file, never editing this
 * module. Each delta is validated structurally (`validate.ts`), merged over the
 * base (`resolve.ts`), and coherence-checked; a file that fails any step lands
 * in `PROFILE_DIAGNOSTICS` and is excluded from `PROFILES`, so one bad file out
 * of hundreds degrades that one profile instead of taking down the app. The
 * committed tree must keep `PROFILE_DIAGNOSTICS` empty — the invariant test
 * suite enforces it.
 */

import baseJson from "./base.json";
import type { RegisteredSourceProfile, SourceProfile } from "../engine/adapter-types";
import type { SourceProfileBase } from "./schema";
import { validateBase, validateDelta } from "./validate";
import { mergeProfile } from "./resolve";

/** A profile file the registry refused, and why. */
export type ProfileLoadIssue = {
  /** Module path of the offending file, e.g. "./sources/foo.json". */
  file: string;
  /** The profile id if one could be read, else null. */
  profileId: string | null;
  problems: string[];
};

const deltaModules = import.meta.glob("./sources/*.json", { eager: true, import: "default" });

function buildRegistry(): {
  base: SourceProfileBase | null;
  profiles: Record<string, RegisteredSourceProfile>;
  diagnostics: ProfileLoadIssue[];
} {
  const diagnostics: ProfileLoadIssue[] = [];
  const profiles: Record<string, RegisteredSourceProfile> = {};

  const baseResult = validateBase(baseJson);
  if (!baseResult.ok) {
    // Without a valid base nothing can resolve; report it once and register
    // no profiles rather than registering 400 differently-broken ones.
    diagnostics.push({ file: "./base.json", profileId: null, problems: baseResult.problems });
    return { base: null, profiles, diagnostics };
  }
  const base = baseResult.value;

  const seenSourceUrls = new Map<string, string>();
  // Sorted for a deterministic winner when two files collide on id or URL.
  for (const file of Object.keys(deltaModules).sort()) {
    const stem = file.replace(/^\.\/sources\//, "").replace(/\.json$/, "");
    const result = validateDelta(deltaModules[file]);
    if (!result.ok) {
      diagnostics.push({ file, profileId: null, problems: result.problems });
      continue;
    }
    const delta = result.value;

    const problems: string[] = [];
    if (delta.id !== stem) {
      problems.push(`id "${delta.id}" does not match its filename "${stem}.json"; the file cannot be found from its id.`);
    }
    if (delta.id in profiles) {
      problems.push(`id "${delta.id}" is already registered; ids must be unique.`);
    }
    const urlOwner = seenSourceUrls.get(delta.sourceUrl);
    if (urlOwner !== undefined) {
      problems.push(`sourceUrl "${delta.sourceUrl}" is already claimed by "${urlOwner}"; source URLs must be unique.`);
    }

    let merged: RegisteredSourceProfile | null = null;
    if (problems.length === 0) {
      merged = mergeProfile(base, delta);
      problems.push(...findProfileContradictions(merged), ...findRegisteredProfileContradictions(merged));
    }

    if (problems.length > 0 || merged === null) {
      diagnostics.push({ file, profileId: delta.id, problems });
      continue;
    }
    profiles[delta.id] = merged;
    seenSourceUrls.set(delta.sourceUrl, delta.id);
  }

  return { base, profiles, diagnostics };
}

const registry = buildRegistry();

/** The validated shared defaults, or null when base.json itself is broken. */
export const PROFILE_BASE: SourceProfileBase | null = registry.base;

/** Every coherent registered profile, keyed by id. */
export const PROFILES: Record<string, RegisteredSourceProfile> = registry.profiles;

/** Files the registry refused. Empty in a healthy tree. */
export const PROFILE_DIAGNOSTICS: ProfileLoadIssue[] = registry.diagnostics;

/**
 * Kept as a named export because the Bellingham profile predates the registry
 * and is referenced directly by the upload default and several tests.
 */
export const BELLINGHAM_PROCUREWARE: RegisteredSourceProfile = (() => {
  const profile = PROFILES["bellingham-procureware"];
  if (!profile) {
    throw new Error(
      `The bellingham-procureware profile failed to register: ${JSON.stringify(PROFILE_DIAGNOSTICS)}`
    );
  }
  return profile;
})();

export function getProfile(id: string): RegisteredSourceProfile | null {
  const profile = PROFILES[id];
  return profile ? (assertProfileCoherent(profile) as RegisteredSourceProfile) : null;
}

/** Lightweight rows for pickers and search — no policy payload. */
export function listProfiles(): Array<{
  id: string;
  displayName: string;
  sourceUrl: string;
  agency?: string;
  version: number;
}> {
  return Object.values(PROFILES)
    .map((profile) => ({
      id: profile.id,
      displayName: profile.displayName ?? profile.id,
      sourceUrl: profile.sourceUrl,
      agency: profile.agency,
      version: profile.version
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Refuse to serve a profile whose rules contradict each other.
 *
 * Registration already filters incoherent profiles, so via the registry this
 * never throws; it remains on the direct-call path as defense in depth.
 */
export function assertProfileCoherent(profile: SourceProfile): SourceProfile {
  const problems = findProfileContradictions(profile);
  if (problems.length > 0) {
    throw new Error(`Profile "${profile.id}" is self-contradictory and cannot be used: ${problems.join(" ")}`);
  }
  return profile;
}

/**
 * Contradictions a profile can express that the type system cannot catch.
 *
 * Each of these would silently change what recovery is permitted to do, so they
 * are checked rather than trusted. Checked on the MERGED result, not the delta:
 * a delta can empty an inherited list by replacement, so only the resolved
 * profile shows what would actually govern.
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

  for (const field of profile.hardRequiredFields) {
    if (excluded.has(field)) {
      problems.push(`"${field}" is both hardRequired and excluded; a field can not be required yet never compared.`);
    }
  }

  if (profile.primaryKey.length === 0) {
    problems.push("primaryKey is empty; no record can be identified.");
  }
  if (profile.dedupeKey.length === 0) {
    problems.push("dedupeKey is empty; duplicates cannot be detected.");
  }
  if (profile.collectionPath.length === 0) {
    problems.push("collectionPath is empty; the records array cannot be located.");
  }
  if (profile.minimumMatchRate < 0 || profile.minimumMatchRate > 1) {
    problems.push(`minimumMatchRate ${profile.minimumMatchRate} is outside 0..1.`);
  }
  if (profile.version < 1 || !Number.isInteger(profile.version)) {
    problems.push(`version ${profile.version} is not a positive integer; provenance could not identify the governing policy.`);
  }

  // AGENTS.md rule 6: approving a date-sensitive field demands an explicit,
  // auditable marker in the notes, not just quiet membership in both lists.
  const dateSensitive = new Set(profile.dateSensitiveFields ?? []);
  const notes = (profile.notes ?? []).join(" ").toUpperCase();
  for (const field of backfillable) {
    if (dateSensitive.has(field) && !((notes.includes("RULE 6") || notes.includes("APPROVAL")) && notes.includes(field.toUpperCase()))) {
      problems.push(
        `"${field}" is date-sensitive yet approved for backfill without a note naming it in a "RULE 6" or "APPROVAL" record (AGENTS.md rule 6).`
      );
    }
  }

  return problems;
}

/** Contradictions only expressible on the registered (metadata-bearing) shape. */
export function findRegisteredProfileContradictions(profile: RegisteredSourceProfile): string[] {
  const problems: string[] = [];

  if (profile.sourceUrl.length === 0) {
    problems.push("sourceUrl is empty; the profile cannot be tied to a source.");
  }

  const { quality } = profile;
  for (const [role, field] of Object.entries(quality.searchSourceFields)) {
    if (field.length === 0) {
      problems.push(`quality.searchSourceFields.${role} is empty; search cannot index that role.`);
    }
  }
  for (const group of quality.fieldGroups) {
    if (group.thresholdDrop < 0 || group.thresholdDrop > 1) {
      problems.push(`quality.fieldGroups["${group.id}"].thresholdDrop ${group.thresholdDrop} is outside 0..1.`);
    }
    if (group.minAffectedFields < 1) {
      problems.push(`quality.fieldGroups["${group.id}"].minAffectedFields must be at least 1.`);
    }
  }
  for (const pair of quality.documentFieldPairs) {
    if (pair.docs.length === 0 || pair.hashes.length === 0) {
      problems.push("quality.documentFieldPairs contains an empty docs or hashes field name.");
    }
  }

  return problems;
}
